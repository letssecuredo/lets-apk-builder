#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const apkPath = process.argv[2];
const buildId = process.argv[3];

if (!apkPath || !buildId) {
  console.error("Usage: upload-to-firebase.js <apkPath> <buildId>");
  process.exit(1);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error("FIREBASE_SERVICE_ACCOUNT missing");
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(raw);
} catch {
  // maybe base64
  sa = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${sa.project_id}.appspot.com`,
});

(async () => {
  const bucket = admin.storage().bucket();
  const dest = `apks/${buildId}/app-release.apk`;
  await bucket.upload(apkPath, {
    destination: dest,
    metadata: {
      contentType: "application/vnd.android.package-archive",
      cacheControl: "public, max-age=31536000",
    },
  });

  const file = bucket.file(dest);
  // Make public OR generate a 7-day signed URL
  try {
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${dest}`;
    console.log(publicUrl);
  } catch {
    const [signed] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    console.log(signed);
  }
})();
