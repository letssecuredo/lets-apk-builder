#!/usr/bin/env node
/* Sends a signed webhook to the backend. Usage: node notify-webhook.js <status> [error] */
const crypto = require("crypto");
const fetch = require("node-fetch");

const status = process.argv[2] || "building";
const errorMsg = process.argv[3] || undefined;

const BUILD_ID = process.env.BUILD_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const APK_URL = process.env.APK_URL;

if (!BUILD_ID || !WEBHOOK_URL || !SECRET) {
  console.error("Missing BUILD_ID, WEBHOOK_URL or WEBHOOK_SECRET");
  process.exit(1);
}

const body = {
  buildId: BUILD_ID,
  status,
  timestamp: new Date().toISOString(),
};
if (APK_URL) body.apkUrl = APK_URL;
if (errorMsg) body.error = errorMsg;

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
    console.log("Webhook sent", status, res.status, await res.text());
    if (!res.ok) process.exit(1);
  } catch (e) {
    console.error("Webhook error:", e.message);
    process.exit(1);
  }
})();
