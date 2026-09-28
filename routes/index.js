const express = require("express");
const router = express.Router();
const buildRoutes = require("./build.routes");
const webhookRoutes = require("./webhook.routes");
const ctrl = require("../controllers/build.controller");
const { apiLimiter } = require("../middleware/rateLimitMiddleware");
const { optionalAuth } = require("../middleware/authMiddleware");

router.use("/build", buildRoutes);
router.use("/webhook", webhookRoutes);

router.get("/build/:id", apiLimiter, optionalAuth, ctrl.getBuildById);
router.get("/download/:id", apiLimiter, ctrl.downloadBuild);
router.get("/builds", apiLimiter, optionalAuth, ctrl.listBuildsHandler);

// ⭐ Internal endpoint — worker only
router.get("/internal/config/:buildId", ctrl.getInternalConfig);

router.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

module.exports = router;
