const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.field = field;
  }
}

function assert(cond, message, field) {
  if (!cond) throw new ValidationError(message, field);
}

const PERMISSION_KEYS = [
  "enableJs", "enableNetworkState",
  "enableCamera", "enableMicrophone", "enableAudioSettings", "enableFileUpload",
  "enableGeolocation", "enableCoarseLocation", "enableBackgroundLocation",
  "enableReadMediaImages", "enableReadMediaVideo", "enableReadMediaAudio", "enableStorage",
  "enableBluetooth", "enableBluetoothLegacy", "enableNfc", "enableNearbyWifi",
  "enableWifi", "enableChangeWifi", "enableChangeNetwork",
  "enableVibration", "enableWakeLock", "enableFlashlight", "enableBodySensors", "enableActivityRecognition",
  "enableReadPhoneState", "enableCallPhone", "enableReadContacts", "enableWriteContacts", "enableGetAccounts",
  "enableSendSms", "enableReceiveSms", "enableReadSms",
  "enableReadCalendar", "enableWriteCalendar",
  "enableNotifications", "enableForegroundService", "enableBootCompleted", "enableInstallShortcut",
  "enableSystemAlertWindow", "enableInstallPackages",
  "enableBiometric", "enableFingerprint",
];

function validateConfig(body) {
  assert(body && typeof body === "object", "Missing request body");

  // ─── App mode ───
  const appMode = String(body.appMode || "hybrid");
  assert(["offline", "online", "hybrid"].includes(appMode), "appMode must be offline|online|hybrid", "appMode");

  const appName = String(body.appName || "").trim();
  assert(appName.length >= 1 && appName.length <= 50, "appName must be 1-50 chars", "appName");

  // ─── Website URL (only required for online/hybrid) ───
  let websiteUrl = String(body.websiteUrl || "").trim();
  if (appMode === "offline") {
    // No real URL needed — keep a placeholder for Firestore
    websiteUrl = websiteUrl || "https://example.com";
  } else {
    assert(websiteUrl.length > 0, "websiteUrl is required", "websiteUrl");
    let parsedUrl;
    try { parsedUrl = new URL(websiteUrl); } catch { throw new ValidationError("websiteUrl is not a valid URL", "websiteUrl"); }
    assert(parsedUrl.protocol === "https:", "websiteUrl must use https://", "websiteUrl");
  }

  const packageName = String(body.packageName || "").trim();
  assert(PACKAGE_RE.test(packageName), "packageName must match com.example.app", "packageName");
  assert(packageName.length <= 100, "packageName too long", "packageName");

  const versionName = String(body.versionName || "1.0.0").trim();
  assert(SEMVER_RE.test(versionName), "versionName must be semver (e.g. 1.0.0)", "versionName");

  const versionCode = Number(body.versionCode ?? 1);
  assert(Number.isInteger(versionCode) && versionCode >= 1 && versionCode <= 2100000000, "versionCode must be a positive integer", "versionCode");

  const themeColor = String(body.themeColor || "#1f6feb").trim();
  assert(HEX_COLOR_RE.test(themeColor), "themeColor must be a hex color", "themeColor");

  let iconBase64 = body.iconBase64 ? String(body.iconBase64) : null;
  if (iconBase64) {
    const m = iconBase64.match(/^data:image\/png;base64,(.+)$/);
    assert(m, "iconBase64 must be a PNG data URL", "iconBase64");
    assert(m[1].length <= 700_000, "Icon must be ≤ 500 KB", "iconBase64");
  }

  // ─── Offline ZIP (mode-dependent) ───
  let offlineZipBase64 = null;
  let offlineZipName = null;
  let offlineZipSize = 0;

  if (body.offlineZipBase64) {
    const raw = String(body.offlineZipBase64);
    const dm = raw.match(/^data:[^;]+;base64,(.+)$/);
    const b64 = dm ? dm[1] : raw;

    assert(b64.length <= 4_500_000, "Offline ZIP must be ≤ 3 MB", "offlineZipBase64");
    assert(/^[A-Za-z0-9+/=\s]+$/.test(b64), "offlineZipBase64: invalid characters", "offlineZipBase64");

    offlineZipBase64 = b64.replace(/\s+/g, "");
    offlineZipName = String(body.offlineZipName || "site.zip").slice(0, 80);
    offlineZipSize = Math.floor((offlineZipBase64.length * 3) / 4);
  }

  // Offline mode REQUIRES ZIP
  if (appMode === "offline") {
    assert(offlineZipBase64, "Offline mode requires an offline ZIP bundle", "offlineZipBase64");
  }

  const orientation = String(body.orientation || "portrait");
  assert(["portrait", "landscape", "auto"].includes(orientation), "orientation must be portrait|landscape|auto", "orientation");

  const config = {
    appMode,
    appName, websiteUrl, packageName, versionName, versionCode,
    themeColor, iconBase64, orientation,
    hasOfflineZip: !!offlineZipBase64,
    offlineZipName,
    offlineZipSize,
    offlineZipBase64,
  };

  for (const key of PERMISSION_KEYS) {
    config[key] = typeof body[key] === "boolean" ? body[key] : false;
  }
  if (body.enableJs === undefined) config.enableJs = true;
  if (body.enableFileUpload === undefined) config.enableFileUpload = true;
  if (body.enableNetworkState === undefined) config.enableNetworkState = true;

  const serialized = JSON.stringify(config);
  assert(serialized.length <= 10_000_000, "Config too large (max 10 MB)", "body");

  return config;
}

module.exports = { validateConfig, ValidationError, PERMISSION_KEYS };
