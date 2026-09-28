#!/usr/bin/env node
/* Generates a complete Android WebView project from config.json */
const fs = require("fs");
const path = require("path");

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
  path.join(resDir, "mipmap-anydpi-v26"),
  path.join(resDir, "mipmap-hdpi"),
  path.join(resDir, "mipmap-mdpi"),
  path.join(resDir, "mipmap-xhdpi"),
  path.join(resDir, "mipmap-xxhdpi"),
  path.join(resDir, "mipmap-xxxhdpi"),
  assetsDir,
  path.join(ROOT, "gradle/wrapper"),
]) fs.mkdirSync(d, { recursive: true });

// ---------- Root build.gradle ----------
fs.writeFileSync(
  path.join(ROOT, "build.gradle"),
`// Top-level build file
buildscript {
  repositories { google(); mavenCentral() }
  dependencies {
    classpath 'com.android.tools.build:gradle:8.5.2'
    classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24'
  }
}
allprojects { repositories { google(); mavenCentral() } }
`
);

// ---------- settings.gradle ----------
fs.writeFileSync(
  path.join(ROOT, "settings.gradle"),
`pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "LetsApkBuilder"
include ':app'
`
);

// ---------- gradle.properties ----------
fs.writeFileSync(
  path.join(ROOT, "gradle.properties"),
`org.gradle.jvmargs=-Xmx3g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.enableJetifier=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`
);

// ---------- gradle wrapper ----------
fs.writeFileSync(
  path.join(ROOT, "gradle/wrapper/gradle-wrapper.properties"),
`distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`
);

// Download gradle-wrapper.jar from a known source is unreliable in a script; instead
// we assume `gradle wrapper` was run previously OR use the system gradle.
// Safer: create a lightweight gradlew that uses system `gradle` (preinstalled on ubuntu-latest with setup-android? not always).
// Instead we ship a gradle wrapper jar fetched at runtime.

fs.writeFileSync(
  path.join(ROOT, "gradlew"),
`#!/bin/sh
# Lightweight gradle wrapper that downloads gradle if missing
set -e
GRADLE_VERSION=8.7
GRADLE_HOME="$HOME/.gradle-dist/$GRADLE_VERSION"
if [ ! -x "$GRADLE_HOME/bin/gradle" ]; then
  mkdir -p "$HOME/.gradle-dist"
  cd "$HOME/.gradle-dist"
  if [ ! -f "gradle-$GRADLE_VERSION-bin.zip" ]; then
    curl -sSL -o gradle-$GRADLE_VERSION-bin.zip "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  fi
  unzip -q -o gradle-$GRADLE_VERSION-bin.zip
  mv gradle-$GRADLE_VERSION "$GRADLE_HOME"
  cd - >/dev/null
fi
exec "$GRADLE_HOME/bin/gradle" "$@"
`
);
fs.chmodSync(path.join(ROOT, "gradlew"), 0o755);

// ---------- app/build.gradle ----------
const minSdk = 21;
const targetSdk = 34;
fs.writeFileSync(
  path.join(ROOT, "app/build.gradle"),
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

  signingConfigs {
    release {
      // Signing done externally via apksigner; keep debug fallback
    }
  }

  buildTypes {
    release {
      minifyEnabled false
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = '17' }
  buildFeatures { buildConfig = true }
}

dependencies {
  implementation 'androidx.core:core-ktx:1.13.1'
  implementation 'androidx.appcompat:appcompat:1.7.0'
  implementation 'androidx.webkit:webkit:1.11.0'
  implementation 'com.google.android.material:material:1.12.0'
}
`
);

fs.writeFileSync(
  path.join(ROOT, "app/proguard-rules.pro"),
`-keep class ${cfg.packageName}.** { *; }
-dontwarn android.webkit.**
`
);

// ---------- AndroidManifest.xml ----------
const permissions = ['<uses-permission android:name="android.permission.INTERNET" />'];
if (cfg.enableCamera) {
  permissions.push('<uses-permission android:name="android.permission.CAMERA" />');
  permissions.push('<uses-feature android:name="android.hardware.camera" android:required="false" />');
}
if (cfg.enableGeolocation) {
  permissions.push('<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />');
  permissions.push('<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />');
}
if (cfg.enableFileUpload || cfg.enableStorage) {
  permissions.push('<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />');
  permissions.push('<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />');
}

const orientationAttr =
  cfg.orientation === "landscape" ? 'android:screenOrientation="landscape"'
  : cfg.orientation === "portrait" ? 'android:screenOrientation="portrait"'
  : 'android:screenOrientation="unspecified"';

const manifest =
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

  ${permissions.join("\n  ")}

  <application
      android:allowBackup="true"
      android:icon="@mipmap/ic_launcher"
      android:label="@string/app_name"
      android:roundIcon="@mipmap/ic_launcher"
      android:supportsRtl="true"
      android:usesCleartextTraffic="false"
      android:networkSecurityConfig="@xml/network_security_config"
      android:theme="@style/Theme.AppCompat.Light.NoActionBar">

      <activity
          android:name=".MainActivity"
          android:exported="true"
          android:configChanges="orientation|screenSize|keyboardHidden"
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

// ---------- res/values/strings.xml, colors.xml, styles.xml ----------
fs.writeFileSync(
  path.join(resDir, "values/strings.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${escapeXml(cfg.appName)}</string>
</resources>
`
);

fs.writeFileSync(
  path.join(resDir, "values/colors.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="theme_color">${cfg.themeColor}</color>
  <color name="theme_color_dark">${cfg.themeColor}</color>
</resources>
`
);

fs.writeFileSync(
  path.join(resDir, "values/styles.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="colorPrimary">@color/theme_color</item>
    <item name="colorPrimaryDark">@color/theme_color_dark</item>
    <item name="colorAccent">@color/theme_color</item>
  </style>
</resources>
`
);

// ---------- network security ----------
fs.writeFileSync(
  path.join(resDir, "xml/network_security_config.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`
);

// ---------- Icon: use provided base64 or generate a placeholder ----------
let iconBuffer = null;
if (cfg.iconBase64) {
  const m = cfg.iconBase64.match(/^data:image\/png;base64,(.+)$/);
  if (m) iconBuffer = Buffer.from(m[1], "base64");
}
// Fallback: solid color 1x1 PNG (will be upscaled by launcher) - we generate a small
// valid PNG with the theme color.
if (!iconBuffer) iconBuffer = generateSolidPng(cfg.themeColor);

for (const d of ["mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"]) {
  fs.writeFileSync(path.join(resDir, d, "ic_launcher.png"), iconBuffer);
}
// Adaptive icon XML fallback
fs.writeFileSync(
  path.join(resDir, "mipmap-anydpi-v26/ic_launcher.xml"),
`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/theme_color" />
  <foreground android:drawable="@mipmap/ic_launcher" />
</adaptive-icon>
`
);

// ---------- assets/config.json ----------
fs.writeFileSync(
  path.join(assetsDir, "config.json"),
  JSON.stringify(
    {
      websiteUrl: cfg.websiteUrl,
      themeColor: cfg.themeColor,
      enableJs: cfg.enableJs,
      enableFileUpload: cfg.enableFileUpload,
      enableCamera: cfg.enableCamera,
      enableGeolocation: cfg.enableGeolocation,
      orientation: cfg.orientation,
    },
    null,
    2
  )
);

// ---------- MainActivity.kt ----------
const mainActivity =
`package ${cfg.packageName}

import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import android.webkit.GeolocationPermissions

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserRequestCode = 1001

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
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            javaScriptCanOpenWindowsAutomatically = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return if (url.startsWith("http")) { view?.loadUrl(url); true } else false
            }
        }

        if (config.optBoolean("enableFileUpload", true)) {
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
                        startActivityForResult(intent, fileChooserRequestCode)
                        true
                    } catch (e: Exception) {
                        this@MainActivity.filePathCallback = null
                        false
                    }
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
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl(config.optString("websiteUrl", "https://example.com"))
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        if (requestCode == fileChooserRequestCode) {
            filePathCallback?.onReceiveValue(
                FileChooserParams.parseResult(resultCode, data)
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

console.log("Android project generated at", ROOT);

// ---------- helpers ----------
function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[c]));
}

/** Generate a minimal valid PNG of a given solid color (uses zlib via Buffer). */
function generateSolidPng(hex) {
  // Simple 1x1 RGBA PNG encoder
  const { deflateSync } = require("zlib");
  const r = parseInt(hex.slice(1, 3), 16) || 0x1f;
  const g = parseInt(hex.slice(3, 5), 16) || 0x6f;
  const b = parseInt(hex.slice(5, 7), 16) || 0xeb;

  const width = 1, height = 1;
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  // IDAT: raw scanline = filter(0) + RGBA pixel
  const raw = Buffer.from([0, r, g, b, 255]);
  const idat = chunk("IDAT", deflateSync(raw));

  // IEND
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
