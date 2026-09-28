const express = require("express");
const router = express.Router();
const { buildLimiter, apiLimiter } = require("../middleware/rateLimitMiddleware");
const { validateBuildBody } = require("../middleware/validationMiddleware");
const { optionalAuth } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/build.controller");

router.post("/", buildLimiter, validateBuildBody, ctrl.createBuild);
router.get("/", apiLimiter, optionalAuth, ctrl.listBuildsHandler);

module.exports = router;
