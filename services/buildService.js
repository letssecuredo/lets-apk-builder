const { getDb } = require("../firebase/firestore");
const { nowIso } = require("../utils/helpers");
const logger = require("../utils/logger");

const COLLECTION = "builds";

async function saveBuild(build) {
  const db = getDb();
  await db.collection(COLLECTION).doc(build.id).set(build, { merge: true });
  return build;
}

async function getBuild(id) {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function updateBuild(id, patch) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).set(patch, { merge: true });
  logger.info("build updated", id, patch.status || "");
  return getBuild(id);
}

async function listBuilds({ limit = 20, userId = null } = {}) {
  const db = getDb();
  let q = db.collection(COLLECTION).orderBy("createdAt", "desc").limit(Math.min(limit, 100));
  if (userId) q = q.where("userId", "==", userId);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function appendLog(id, line) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).set(
    { logs: require("firebase-admin").firestore.FieldValue.arrayUnion(line) },
    { merge: true }
  );
}

function newBuildRecord({ id, config, userId }) {
  return {
    id,
    userId: userId || null,
    status: "queued",
    config,
    apkUrl: null,
    error: null,
    logs: [`[${nowIso()}] Build queued`],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: null,
  };
}

module.exports = { saveBuild, getBuild, updateBuild, listBuilds, appendLog, newBuildRecord };
