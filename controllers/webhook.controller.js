const { updateBuild } = require("../services/buildService");
const { verifyHmac, isFreshTimestamp, nowIso } = require("../utils/helpers");
const { record } = require("../services/auditService");
const logger = require("../utils/logger");

const ALLOWED = new Set([
  "queued",
  "building",
  "signing",
  "uploading",
  "completed",
  "failed",
]);

async function githubWebhook(req, res, next) {
  try {
    const raw = JSON.stringify(req.body);
    const signature = req.headers["x-hub-signature-256"];

    // 1. Verify HMAC signature
    if (!verifyHmac(process.env.WEBHOOK_SECRET, raw, signature)) {
      logger.warn("webhook HMAC verification failed", req.ip);
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 2. Extract fields
    const {
      buildId,
      status,
      apkUrl,
      error,
      logs,
      currentStep,
      stepIndex,
      timestamp,
    } = req.body || {};

    if (!buildId) return res.status(400).json({ error: "buildId required" });
    if (status && !ALLOWED.has(status)) {
      return res.status(400).json({ error: "invalid status" });
    }
    if (!isFreshTimestamp(timestamp)) {
      return res.status(400).json({ error: "stale timestamp" });
    }

    // 3. Build patch
    const patch = { updatedAt: nowIso() };
    if (status) patch.status = status;
    if (apkUrl) patch.apkUrl = apkUrl;
    if (error) patch.error = String(error).slice(0, 4000);
    if (Array.isArray(logs)) patch.logs = logs.slice(0, 500);
    if (currentStep) patch.currentStep = String(currentStep).slice(0, 200);
    if (typeof stepIndex === "number") patch.stepIndex = stepIndex;
    if (status === "completed" || status === "failed") {
      patch.completedAt = nowIso();
    }

    // 4. Save to Firestore
    await updateBuild(buildId, patch);

    // 5. Audit log
    await record("build.webhook", { buildId, status, currentStep });

    logger.info("webhook processed", buildId, status, currentStep || "");
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { githubWebhook };
