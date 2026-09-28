#!/usr/bin/env node
/**
 * Sends a signed webhook to update the current build step.
 * Usage: node notify-step.js   (reads env vars)
 */
const crypto = require("crypto");
const fetch = require("node-fetch");

const BUILD_ID = process.env.BUILD_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const STEP_NAME = process.env.STEP_NAME;
const STEP_INDEX = Number(process.env.STEP_INDEX || 0);

if (!BUILD_ID || !WEBHOOK_URL || !SECRET || !STEP_NAME) {
  console.error("Missing BUILD_ID, WEBHOOK_URL, WEBHOOK_SECRET or STEP_NAME");
  process.exit(1);
}

const body = {
  buildId: BUILD_ID,
  status: "building",
  currentStep: STEP_NAME,
  stepIndex: STEP_INDEX,
  timestamp: new Date().toISOString(),
};

const payload = JSON.stringify(body);
const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

(async () => {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });
    console.log(`Step ${STEP_INDEX}: ${STEP_NAME} → ${res.status}`);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("Webhook error:", res.status, t);
    }
  } catch (e) {
    console.error("Webhook exception:", e.message);
  }
})();
