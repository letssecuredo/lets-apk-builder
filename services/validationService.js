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

// All permission keys the frontend can send
const PERMISSION_KEYS = [
  "enableJs","enableNetworkState",
  "enableCamera","enableMicrophone","enableAudioSettings","enableFileUpload",
  "enableGeolocation","enableCoarseLocation","enableBackgroundLocation",
  "enableReadMediaImages","enableReadMediaVideo","enableReadMediaAudio","enableStorage",
  "enableBluetooth","enableBluetoothLegacy","enableNfc","enableNearbyWifi",
  "enableWifi","enableChangeWifi","enableChangeNetwork",
  "enableVibration","enableWakeLock","enableFlashlight","enableBodySensors","enableActivityRecognition",
  "enableReadPhoneState","enableCallPhone","enableReadContacts","enableWriteContacts","enableGetAccounts",
  "enableSendSms","enableReceiveSms","enableReadSms",
  "enableReadCalendar","enableWriteCalendar",
  "enableNotifications","enableForegroundService","enableBootCompleted","enableInstallShortcut","enableSystemAlertWindow","enableInstallPackages",
  "enableBiometric","enableFingerprint",
];

function validateConfig(body) {
  assert(body && typeof body === "object", "Missing request body");

  const appName = String(body.appName || "").trim();
  assert(appName.length >= 1 && appName.length <= 50, "appName must be 1-50 chars", "appName");

  const websiteUrl = String(body.websiteUrl || "").trim();
  assert(websiteUrl.length > 0, "websiteUrl is required", "websiteUrl");
  let parsedUrl;
  try { parsedUrl = new URL(websiteUrl); } catch { throw new ValidationError("websiteUrl is not a valid URL", "websiteUrl"); }
  assert(parsedUrl.protocol === "https:", "websiteUrl must use https://", "websiteUrl");

  const packageName = String(body.packageName || "").trim();
  assert(PACKAGE_RE.test(packageName), "packageName must match com.example.app", "packageName");
  assert(packageName.length <= 100, "packageName too long", "packageName");

  const versionName = String(body.versionName || "1.0.0").trim();
  assert(SEMVER_RE.test(versionName), "versionName must be semver", "versionName");

  const versionCode = Number(body.versionCode ?? 1);
  assert(Number.isInteger(versionCode) && versionCode >= 1 && versionCode <= 2100000000, "versionCode must be positive integer", "versionCode");

  const themeColor = String(body.themeColor || "#1f6feb").trim();
  assert(HEX_COLOR_RE.test(themeColor), "themeColor must be a hex color", "themeColor");

  let iconBase64 = body.iconBase64 ? String(body.iconBase64) : null;
  if (iconBase64) {
    const m = iconBase64.match(/^data:image\/png;base64,(.+)$/);
    assert(m, "iconBase64 must be a PNG data URL", "iconBase64");
    assert(m[1].length <= 700_000, "Icon must be ≤ 500 KB", "iconBase64");
  }

  const orientation = String(body.orientation || "portrait");
  assert(["portrait","landscape","auto"].includes(orientation), "orientation invalid", "orientation");

  const config = {
    appName, websiteUrl, packageName, versionName, versionCode,
    themeColor, iconBase64, orientation,
  };

  // Copy all permission flags (boolean only)
  for (const key of PERMISSION_KEYS) {
    config[key] = typeof body[key] === "boolean" ? body[key] : false;
  }

  // Sensible defaults
  if (config.enableJs === false && body.enableJs === undefined) config.enableJs = true;
  if (config.enableFileUpload === false && body.enableFileUpload === undefined) config.enableFileUpload = true;
  if (config.enableNetworkState === false && body.enableNetworkState === undefined) config.enableNetworkState = true;

  const serialized = JSON.stringify(config);
  assert(serialized.length <= 1_000_000, "Config too large (max 1 MB)", "body");

  return config;
}

module.exports = { validateConfig, ValidationError, PERMISSION_KEYS };
