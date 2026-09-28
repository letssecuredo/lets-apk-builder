const admin = require("firebase-admin");

let db = null;
let bucket = null;

function initFirebase() {
  if (admin.apps.length) {
    db = admin.firestore();
    bucket = admin.storage().bucket();
    return { db, bucket };
  }

  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  db = admin.firestore();
  bucket = admin.storage().bucket();
  return { db, bucket };
}

function getDb() {
  if (!db) initFirebase();
  return db;
}

function getBucket() {
  if (!bucket) initFirebase();
  return bucket;
}

module.exports = { initFirebase, getDb, getBucket, admin };
