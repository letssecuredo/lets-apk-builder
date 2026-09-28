#!/usr/bin/env node
const fs = require("fs");

const apkPath = process.argv[2];
const buildId = process.argv[3];

if (!apkPath || !buildId) {
  console.error("Usage: upload-to-github-release.js <apkPath> <buildId>");
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const api = process.env.GH_API_URL || "https://api.github.com";

if (!token || !repo) {
  console.error("Missing GITHUB_TOKEN or GITHUB_REPOSITORY");
  process.exit(1);
}

const tag = `build-${buildId}`;
const assetName = "app-release.apk";
const releaseName = `Build ${buildId.slice(0, 8)}`;

(async () => {
  const createRes = await fetch(`${api}/repos/${repo}/releases`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "lets-apk-builder",
    },
    body: JSON.stringify({
      tag_name: tag,
      name: releaseName,
      body: `APK for build \`${buildId}\`.`,
      draft: false,
      prerelease: false,
    }),
  });

  if (!createRes.ok) {
    const t = await createRes.text();
    console.error("Release create failed:", createRes.status, t);
    process.exit(1);
  }

  const release = await createRes.json();
  console.log("Release created:", release.html_url);

  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${assetName}`;
  const fileBuffer = fs.readFileSync(apkPath);

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(fileBuffer.length),
      "User-Agent": "lets-apk-builder",
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    console.error("Asset upload failed:", uploadRes.status, t);
    process.exit(1);
  }

  const asset = await uploadRes.json();
  console.log(asset.browser_download_url);
})().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
