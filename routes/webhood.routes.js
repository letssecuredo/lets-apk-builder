const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/webhook.controller");

router.post("/github", express.json({ limit: "256kb" }), ctrl.githubWebhook);

module.exports = router;
