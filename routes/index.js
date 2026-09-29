const express = require("express");
const router = express.Router();
const buildRoutes = require("./build.routes");
const webhookRoutes = require("./webhook.routes");
const adminRoutes = require("./admin.routes");
const ctrl = require("../controllers/build.controller");
const { apiLimiter } = require("../middleware/rateLimitMiddleware");
const { optionalAuth } = require("../middleware/authMiddleware");
const fetch = require("node-fetch");

router.use("/build", buildRoutes);
router.use("/webhook", webhookRoutes);
router.use("/admin", adminRoutes);

router.get("/build/:id", apiLimiter, optionalAuth, ctrl.getBuildById);
router.get("/download/:id", apiLimiter, ctrl.downloadBuild);
router.get("/builds", apiLimiter, optionalAuth, ctrl.listBuildsHandler);

// ═══════════════════════════════════════════════════════════════
// PUBLIC: List common modules from GitHub repo
// ═══════════════════════════════════════════════════════════════
router.get("/common-modules", async (_req, res) => {
  try {
    const repo = process.env.GITHUB_REPO;
    const ref = process.env.GITHUB_REF || "main";
    if (!repo) return res.json({ modules: [] });

    const url = `https://raw.githubusercontent.com/${repo}/${ref}/templates/common-modules.json`;
    const r = await fetch(url, { timeout: 8000 });

    if (!r.ok) return res.json({ modules: [] });

    const registry = await r.json();
    const modules = (registry.modules || []).map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      default: m.default,
      compatible: m.compatible,
    }));
    res.json({ modules });
  } catch (err) {
    res.json({ modules: [] });
  }
});

// Worker-only internal endpoints
router.get("/internal/config/:buildId", ctrl.getInternalConfig);
router.get("/internal/zip/:buildId", ctrl.getInternalZip);
router.get("/internal/modules/:buildId", ctrl.getInternalModulesList);
router.get("/internal/module/:buildId/:moduleId", ctrl.getInternalModule);

router.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

module.exports = router;
