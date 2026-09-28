const { v4: uuidv4 } = require("uuid");
const { newBuildRecord, saveBuild, getBuild, listBuilds } = require("../services/buildService");
const { triggerBuildWorkflow } = require("../services/githubService");
const { record } = require("../services/auditService");
const logger = require("../utils/logger");

async function createBuild(req, res, next) {
  try {
    const config = req.validatedConfig;
    const buildId = uuidv4();
    const record_ = newBuildRecord({ id: buildId, config, userId: req.user?.uid });

    await saveBuild(record_);

    try {
      await triggerBuildWorkflow(buildId, config);
    } catch (triggerErr) {
      await saveBuild({ id: buildId, status: "failed", error: triggerErr.message, updatedAt: new Date().toISOString() });
      throw triggerErr;
    }

    await record("build.created", { buildId, ip: req.ip });
    logger.info("build created", buildId);
    res.status(201).json({ buildId, status: "queued" });
  } catch (err) { next(err); }
}

async function getBuildById(req, res, next) {
  try {
    const build = await getBuild(req.params.id);
    if (!build) return res.status(404).json({ error: "Build not found" });
    if (process.env.JWT_ENABLED === "true" && build.userId && req.user?.uid && build.userId !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { config, ...safe } = build;
    res.json({ ...safe, config: { ...config, iconBase64: undefined } });
  } catch (err) { next(err); }
}

async function listBuildsHandler(req, res, next) {
  try {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const userId = process.env.JWT_ENABLED === "true" ? req.user?.uid : null;
    const builds = await listBuilds({ limit, userId });
    res.json({
      builds: builds.map((b) => {
        const { config, ...rest } = b;
        return { ...rest, config: config ? { ...config, iconBase64: undefined } : null };
      }),
    });
  } catch (err) { next(err); }
}

async function downloadBuild(req, res, next) {
  try {
    const build = await getBuild(req.params.id);
    if (!build) return res.status(404).json({ error: "Build not found" });
    if (build.status !== "completed" || !build.apkUrl) {
      return res.status(409).json({ error: "Build not completed", status: build.status });
    }
    // Redirect to signed Firebase URL (already public-read or signed by worker)
    return res.redirect(302, build.apkUrl);
  } catch (err) { next(err); }
}

module.exports = { createBuild, getBuildById, listBuildsHandler, downloadBuild };
