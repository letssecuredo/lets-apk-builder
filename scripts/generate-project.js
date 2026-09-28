#!/usr/bin/env node
/* Generates a complete Android WebView project from config.json
 * Supports 40+ Android permissions + 3 app modes:
 *   - offline  → always use bundled assets/index.html
 *   - online   → always use live URL
 *   - hybrid   → live URL when online, bundled assets when offline
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const configPath = process.argv[2] || "config.json";
const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));

const ROOT = path.resolve("android-project");
const pkgPath = cfg.packageName.split(".").join("/");
const javaDir = path.join(ROOT, "app/src/main/java", pkgPath);
const resDir = path.join(ROOT, "app/src/main/res");
const assetsDir = path.join(ROOT, "app/src/main/assets");

// Clean
fs.rmSync(ROOT, { recursive: true, force: true });

// Dirs
for (const d of [
  javaDir,
  path.join(resDir, "values"),
  path.join(resDir, "xml"),
  path.join(resDir, "mipmap-hdpi"),
  path.join(resDir, "mipmap-mdpi"),
  path.join(resDir, "mipmap-xhdpi"),
  path.join(resDir, "mipmap-xxhdpi"),
  path.join(resDir, "mipmap-xxxhdpi"),
  assetsDir,
]) fs.mkdirSync(d, { recursive: true });

// ─── Offline ZIP extraction ───
const offlineZipB64Path = path.join(process.cwd(), "offline.zip.b64");
let hasOffline = false;
if (fs.existsSync(offlineZipB64Path)) {
  const b64 = fs.readFileSync(offlineZipB64Path, "utf8").trim();
  if (b64) {
    try {
      const zipBuffer = Buffer.from(b64, "base64");
      const zipPath = path.join(process.cwd(), "offline.zip");
      fs.writeFileSync(zipPath, zipBuffer);
      console.log("Extracting offline ZIP:", zipBuffer.length, "bytes");
      execSync(`unzip -q -o "${zipPath}" -d "${assetsDir}"`, { stdio: "inherit" });
      fs.unlinkSync(zipPath);
      hasOffline = true;
      console.log("✓ Offline assets extracted to assets/");
    } catch (e) {
      console.warn("Offline ZIP extraction failed:", e.message);
    }
  }
}
console.log("hasOffline:", hasOffline);

// ─────────────── Root build.gradle ───────────────
fs.writeFileSync(path.join(ROOT, "build.gradle"),
`plugins {
  id 'com.android.application' version '8.5.2' apply false
  id 'org.jetbrains.kotlin.android' version '1.9.24' apply false
}
`);

// ─────────────── settings.gradle ───────────────
fs.writeFileSync(path.join(ROOT, "settings.gradle"),
`pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
  repositories { google(); mavenCentral() }
}
rootProject.name = "LetsApkBuilder"
include ':app'
`);

// ─────────────── gradle.properties ───────────────
fs.writeFileSync(path.join(ROOT, "gradle.properties"),
`org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`);

// ─────────────── local.properties ───────────────
const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "/usr/local/lib/android/sdk";
fs.writeFileSync(path.join(ROOT, "local.properties"), `sdk.dir=${sdkDir}\n`);

// ─────────────── app/build.gradle ───────────────
const minSdk = 21;
const targetSdk = 34;
fs.writeFileSync(path.join(ROOT, "app/build.gradle"),
`plugins {
  id 'com.android.application'
  id 'org.jetbrains.kotlin.android'
}

android {
  namespace '${cfg.packageName}'
  compileSdk ${targetSdk}

  defaultConfig {
    applicationId "${cfg.packageName}"
    minSdk ${minSdk}
    targetSdk ${targetSdk}
    versionCode ${cfg.versionCode}
    versionName "${cfg.versionName}"
  }

  buildTypes {
    release {
      minifyEnabled false
      crunchPngs false
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }

  aaptOptions { cruncherEnabled = false }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = '17' }
}

dependencies {
  implementation 'androidx.core:core-ktx:1.13.1'
  implementation 'androidx.appcompat:appcompat:1.7.0'
  implementation 'androidx.webkit:webkit:1.11.0'
  implementation 'com.google.android.material:material:1.12.0'
}
`);

fs.writeFileSync(path.join(ROOT, "app/proguard-rules.pro"),
`-keep class ${cfg.packageName}.** { *; }
-dontwarn android.webkit.**
`);

// ═══════════════════════════════════════════════════════════════
// MANIFEST — build permission & feature list
// ═══════════════════════════════════════════════════════════════
const mp = [];
const mf = [];
const rp = [];

mp.push(`<uses-permission android:name="android.permission.INTERNET" />`);

// Network
if (cfg.enableNetworkState) mp.push(`<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`);
if (cfg.enableChangeNetwork) mp.push(`<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />`);

// Camera
if (cfg.enableCamera) {
  mp.push(`<uses-permission android:name="android.permission.CAMERA" />`);
  mf.push(`<uses-feature android:name="android.hardware.camera" android:required="false" />`);
  mf.push(`<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />`);
  rp.push("android.permission.CAMERA");
}

// Microphone
if (cfg.enableMicrophone) {
  mp.push(`<uses-permission android:name="android.permission.RECORD_AUDIO" />`);
  mf.push(`<uses-feature android:name="android.hardware.microphone" android:required="false" />`);
  rp.push("android.permission.RECORD_AUDIO");
}

// Audio settings
if (cfg.enableAudioSettings) mp.push(`<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />`);

// Location
if (cfg.enableGeolocation) {
  mp.push(`<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />`);
  rp.push("android.permission.ACCESS_FINE_LOCATION");
}
if (cfg.enableCoarseLocation) {
  mp.push(`<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />`);
  rp.push("android.permission.ACCESS_COARSE_LOCATION");
}
if (cfg.enableBackgroundLocation) {
  mp.push(`<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />`);
}
if (cfg.enableGeolocation || cfg.enableCoarseLocation || cfg.enableBackgroundLocation) {
  mf.push(`<uses-feature android:name="android.hardware.location" android:required="false" />`);
  mf.push(`<uses-feature android:name="android.hardware.location.gps" android:required="false" />`);
}

// Storage
if (cfg.enableReadMediaImages) {
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />`);
  rp.push("android.permission.READ_MEDIA_IMAGES");
}
if (cfg.enableReadMediaVideo) {
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />`);
  rp.push("android.permission.READ_MEDIA_VIDEO");
}
if (cfg.enableReadMediaAudio) {
  mp.push(`<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />`);
  rp.push("android.permission.READ_MEDIA_AUDIO");
}
if (cfg.enableStorage || cfg.enableFileUpload) {
  mp.push(`<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />`);
  mp.push(`<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />`);
  rp.push("android.permission.READ_EXTERNAL_STORAGE");
}

// Bluetooth
if (cfg.enableBluetooth) {
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />`);
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />`);
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />`);
  rp.push("android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT");
  mf.push(`<uses-feature android:name="android.hardware.bluetooth" android:required="false" />`);
  mf.push(`<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />`);
}
if (cfg.enableBluetoothLegacy) {
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />`);
  mp.push(`<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />`);
}

// NFC
if (cfg.enableNfc) {
  mp.push(`<uses-permission android:name="android.permission.NFC" />`);
  mf.push(`<uses-feature android:name="android.hardware.nfc" android:required="false" />`);
}

// Nearby WiFi
if (cfg.enableNearbyWifi) {
  mp.push(`<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" android:usesPermissionFlags="neverForLocation" />`);
  rp.push("android.permission.NEARBY_WIFI_DEVICES");
}

// WiFi
if (cfg.enableWifi) mp.push(`<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />`);
if (cfg.enableChangeWifi) mp.push(`<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />`);

// Vibration
if (cfg.enableVibration) mp.push(`<uses-permission android:name="android.permission.VIBRATE" />`);

// Wake lock
if (cfg.enableWakeLock) mp.push(`<uses-permission android:name="android.permission.WAKE_LOCK" />`);

// Flashlight
if (cfg.enableFlashlight) mf.push(`<uses-feature android:name="android.hardware.camera.flash" android:required="false" />`);

// Body sensors
if (cfg.enableBodySensors) {
  mp.push(`<uses-permission android:name="android.permission.BODY_SENSORS" />`);
  rp.push("android.permission.BODY_SENSORS");
}

// Activity recognition
if (cfg.enableActivityRecognition) {
  mp.push(`<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />`);
  rp.push("android.permission.ACTIVITY_RECOGNITION");
}

// Phone
if (cfg.enableReadPhoneState) {
  mp.push(`<uses-permission android:name="android.permission.READ_PHONE_STATE" />`);
  rp.push("android.permission.READ_PHONE_STATE");
}
if (cfg.enableCallPhone) {
  mp.push(`<uses-permission android:name="android.permission.CALL_PHONE" />`);
  rp.push("android.permission.CALL_PHONE");
}

// Contacts
if (cfg.enableReadContacts) {
  mp.push(`<uses-permission android:name="android.permission.READ_CONTACTS" />`);
  rp.push("android.permission.READ_CONTACTS");
}
if (cfg.enableWriteContacts) {
  mp.push(`<uses-permission android:name="android.permission.WRITE_CONTACTS" />`);
  rp.push("android.permission.WRITE_CONTACTS");
}

// Accounts
if (cfg.enableGetAccounts) {
  mp.push(`<uses-permission android:name="android.permission.GET_ACCOUNTS" />`);
  rp.push("android.permission.GET_ACCOUNTS");
}

// SMS
if (cfg.enableSendSms) {
  mp.push(`<uses-permission android:name="android.permission.SEND_SMS" />`);
  rp.push("android.permission.SEND_SMS");
}
if (cfg.enableReceiveSms) {
  mp.push(`<uses-permission android:name="android.permission.RECEIVE_SMS" />`);
  rp.push("android.permission.RECEIVE_SMS");
}
if (cfg.enableReadSms) {
  mp.push(`<uses-permission android:name="android.permission.READ_SMS" />`);
  rp.push("android.permission.READ_SMS");
}

// Calendar
if (cfg.enableReadCalendar) {
  mp.push(`<uses-permission android:name="android.permission.READ_CALENDAR" />`);
  rp.push("android.permission.READ_CALENDAR");
}
if (cfg.enableWriteCalendar) {
  mp.push(`<uses-permission android:name="android.permission.WRITE_CALENDAR" />`);
  rp.push("android.permission.WRITE_CALENDAR");
}

// Notifications
if (cfg.enableNotifications) {
  mp.push(`<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`);
  rp.push("android.permission.POST_NOTIFICATIONS");
}

// Foreground service
if (cfg.enableForegroundService) mp.push(`<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />`);

// Boot
if (cfg.enableBootCompleted) mp.push(`<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`);

// Shortcut
if (cfg.enableInstallShortcut) mp.push(`<uses-permission android:name="android.permission.INSTALL_SHORTCUT" />`);

// System alert window
if (cfg.enableSystemAlertWindow) mp.push(`<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />`);

// Install packages
if (cfg.enableInstallPackages) mp.push(`<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />`);

// Biometric
if (cfg.enableBiometric) {
  mp.push(`<uses-permission android:name="android.permission.USE_BIOMETRIC" />`);
  rp.push("android.permission.USE_BIOMETRIC");
}
if (cfg.enableFingerprint) {
  mp.push(`<uses-permission android:name="android.permission.USE_FINGERPRINT" />`);
  rp.push("android.permission.USE_FINGERPRINT");
}

console.log("Manifest permissions:", mp.length);
console.log("Runtime permissions:", rp.length);

const orientationAttr =
  cfg.orientation === "landscape" ? 'android:screenOrientation="landscape"'
  : cfg.orientation === "portrait" ? 'android:screenOrientation="portrait"'
  : 'android:screenOrientation="unspecified"';

const manifest =
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

  ${mp.join("\n  ")}

  ${mf.join("\n  ")}

  <application
      android:allowBackup="true"
      android:icon="@mipmap/ic_launcher"
      android:label="@string/app_name"
      android:roundIcon="@mipmap/ic_launcher"
      android:supportsRtl="true"
      android:usesCleartextTraffic="false"
      android:hardwareAccelerated="true"
      android:networkSecurityConfig="@xml/network_security_config"
      android:theme="@style/AppTheme">

      <activity
          android:name=".MainActivity"
          android:exported="true"
          android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize"
          android:hardwareAccelerated="true"
          ${orientationAttr}>
          <intent-filter>
              <action android:name="android.intent.action.MAIN" />
              <category android:name="android.intent.category.LAUNCHER" />
          </intent-filter>
      </activity>
  </application>
</manifest>
`;
fs.writeFileSync(path.join(ROOT, "app/src/main/AndroidManifest.xml"), manifest);

// ─── res/values/strings.xml ───
fs.writeFileSync(path.join(resDir, "values/strings.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${escapeXml(cfg.appName)}</string>
</resources>
`);

// ─── res/values/colors.xml ───
fs.writeFileSync(path.join(resDir, "values/colors.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="theme_color">${cfg.themeColor}</color>
  <color name="theme_color_dark">${cfg.themeColor}</color>
</resources>
`);

// ─── res/values/styles.xml ───
fs.writeFileSync(path.join(resDir, "values/styles.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="colorPrimary">@color/theme_color</item>
    <item name="colorPrimaryDark">@color/theme_color_dark</item>
    <item name="colorAccent">@color/theme_color</item>
    <item name="android:windowBackground">@android:color/white</item>
  </style>
</resources>
`);

// ─── network security config ───
fs.writeFileSync(path.join(resDir, "xml/network_security_config.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`);

// ═══════════════════════════════════════════════════════════════
// ICON HANDLING
// ═══════════════════════════════════════════════════════════════
const iconSizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

let userIconPath = null;
if (cfg.iconBase64) {
  const m = cfg.iconBase64.match(/^data:image\/png;base64,(.+)$/);
  if (m) {
    userIconPath = path.join(ROOT, ".user-icon.png");
    fs.writeFileSync(userIconPath, Buffer.from(m[1], "base64"));
    console.log("User icon saved:", fs.statSync(userIconPath).size, "bytes");
  } else {
    console.log("Icon base64 present but regex didn't match");
  }
} else {
  console.log("No iconBase64 in config — using fallback solid color");
}

let magickOk = false;
try {
  execSync("which convert", { stdio: "pipe" });
  magickOk = true;
  console.log("ImageMagick available");
} catch {
  magickOk = false;
  console.log("ImageMagick NOT available — using fallback solid color");
}

for (const [dir, size] of Object.entries(iconSizes)) {
  const dest = path.join(resDir, dir, "ic_launcher.png");
  let done = false;

  if (userIconPath && magickOk) {
    try {
      execSync(
        `convert "${userIconPath}" ` +
        `-background none ` +
        `-resize ${size}x${size} ` +
        `-gravity center ` +
        `-extent ${size}x${size} ` +
        `-strip ` +
        `-define png:color-type=6 ` +
        `-depth 8 ` +
        `PNG32:"${dest}"`,
        { stdio: "pipe" }
      );
      done = true;
      console.log(`✓ Icon ${dir} (${size}x${size}) from user icon`);
    } catch (e) {
      console.warn(`✗ ImageMagick failed for ${dir}: ${e.message}`);
    }
  }

  if (!done) {
    fs.writeFileSync(dest, generateSolidPng(cfg.themeColor, size));
    console.log(`→ Icon ${dir} (${size}x${size}) using fallback color`);
  }
}

if (userIconPath && fs.existsSync(userIconPath)) fs.unlinkSync(userIconPath);

// ─── assets/config.json ───
fs.writeFileSync(path.join(assetsDir, "config.json"),
  JSON.stringify({
    appMode: cfg.appMode || "hybrid",
    websiteUrl: cfg.websiteUrl,
    themeColor: cfg.themeColor,
    enableJs: cfg.enableJs,
    enableFileUpload: cfg.enableFileUpload,
    enableCamera: cfg.enableCamera,
    enableMicrophone: cfg.enableMicrophone,
    enableGeolocation: cfg.enableGeolocation,
    orientation: cfg.orientation,
    hasOffline: hasOffline,
  }, null, 2)
);

// ═══════════════════════════════════════════════════════════════
// MainActivity.kt (3-mode routing)
// ═══════════════════════════════════════════════════════════════
const permsArrayKt = rp.length > 0 ? rp.map(p => `"${p}"`).join(", ") : "";
const hasOfflineStr = hasOffline ? "true" : "false";

const appMode = cfg.appMode || "hybrid";
const appModeStr = JSON.stringify(appMode); // "offline" | "online" | "hybrid"

const mainActivity =
`package ${cfg.packageName}

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserRequestCode = 1001
    private val permissionRequestCode = 2001

    private val startupPermissions = arrayOf(${permsArrayKt})

    // Build-time constants
    private val HAS_OFFLINE = ${hasOfflineStr}
    private val APP_MODE = ${appModeStr}
    private val LIVE_URL = "${cfg.websiteUrl}"
    private val OFFLINE_URL = "file:///android_asset/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val config = readConfig()

        when (config.optString("orientation", "portrait")) {
            "portrait" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "landscape" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = config.optBoolean("enableJs", true)
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            javaScriptCanOpenWindowsAutomatically = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return if (url.startsWith("http") || url.startsWith("file:")) {
                    view?.loadUrl(url); true
                } else false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams?.createIntent()
                return try {
                    if (intent != null) {
                        startActivityForResult(intent, fileChooserRequestCode)
                        true
                    } else {
                        this@MainActivity.filePathCallback = null
                        false
                    }
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                if (config.optBoolean("enableGeolocation", false)) {
                    callback?.invoke(origin, true, false)
                } else {
                    super.onGeolocationPermissionsShowPrompt(origin, callback)
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (startupPermissions.isNotEmpty()) {
            requestStartupPermissions()
        }

        loadBestUrl()
    }

    private fun isOnline(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val n = cm.activeNetwork ?: return false
                val caps = cm.getNetworkCapabilities(n) ?: return false
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            } else {
                @Suppress("DEPRECATION")
                cm.activeNetworkInfo?.isConnected == true
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun loadBestUrl() {
        val url: String? = when (APP_MODE) {
            "offline" -> {
                // Always use bundled content
                if (HAS_OFFLINE) OFFLINE_URL else null
            }
            "online" -> {
                // Always use live URL
                LIVE_URL
            }
            "hybrid" -> {
                // Online → live; Offline → bundled
                if (isOnline()) LIVE_URL
                else if (HAS_OFFLINE) OFFLINE_URL
                else null
            }
            else -> {
                if (isOnline()) LIVE_URL
                else if (HAS_OFFLINE) OFFLINE_URL
                else null
            }
        }

        if (url != null) {
            webView.loadUrl(url)
        } else {
            webView.loadDataWithBaseURL(
                null,
                noInternetHtml(),
                "text/html",
                "UTF-8",
                null
            )
        }
    }

    private fun noInternetHtml(): String {
        return """
            <!DOCTYPE html>
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
              body { font-family: sans-serif; text-align: center; padding: 40px 20px; color: #444; }
              h1 { font-size: 20px; }
              p { font-size: 14px; color: #666; }
              button {
                margin-top: 20px; padding: 12px 24px; font-size: 15px;
                background: #1f6feb; color: white; border: none; border-radius: 8px;
              }
            </style></head>
            <body>
              <h1>📡 Content unavailable</h1>
              <p>Please check your connection and try again.</p>
              <button onclick="location.reload()">Retry</button>
            </body></html>
        """.trimIndent()
    }

    private fun requestStartupPermissions() {
        val missing = startupPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), permissionRequestCode)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode == fileChooserRequestCode) {
            filePathCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            )
            filePathCallback = null
        } else {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    private fun readConfig(): JSONObject {
        return try {
            val text = assets.open("config.json").bufferedReader().use { it.readText() }
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject().put("websiteUrl", "https://example.com")
        }
    }
}
`;
fs.writeFileSync(path.join(javaDir, "MainActivity.kt"), mainActivity);

console.log("✅ Android project generated at", ROOT);
console.log("App mode:", appMode, "| hasOffline:", hasOffline);

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[c]));
}

function generateSolidPng(hex, size = 192) {
  const { deflateSync } = require("zlib");
  const r = parseInt(hex.slice(1, 3), 16) || 0x1f;
  const g = parseInt(hex.slice(3, 5), 16) || 0x6f;
  const b = parseInt(hex.slice(5, 7), 16) || 0xeb;

  const width = size, height = size;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowSize;
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 4] = r;
      raw[off + 2 + x * 4] = g;
      raw[off + 3 + x * 4] = b;
      raw[off + 4 + x * 4] = 255;
    }
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c;
  }
}
