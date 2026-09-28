require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");

const { initFirebase } = require("./firebase/firestore");
const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const logger = require("./utils/logger");

const app = express();

// Trust proxy (Render)
app.set("trust proxy", 1);

// Security
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS
const allowed = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowed.includes("*") || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// JSON body — larger limit for build POST (icon base64 + optional offline ZIP base64)
app.use("/api/webhook", express.json({ limit: "256kb" }));
app.use("/api", express.json({ limit: "10mb" }));

// Firebase
initFirebase();

// Routes
app.use("/api", routes);

// Root
app.get("/", (_req, res) => res.json({ name: "Let-S APK Builder API", status: "ok" }));

// Errors
app.use(notFound);
app.use(errorHandler);

// Listen
const port = Number(process.env.PORT || 10000);
const server = app.listen(port, () => logger.info(`Listening on :${port}`));

// Graceful shutdown
function shutdown(signal) {
  logger.info(`${signal} received, closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
