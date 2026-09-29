#!/usr/bin/env node
/**
 * Fetches custom modules from backend, extracts, validates,
 * replaces placeholders, and installs them into the Android project.
 *
 * Also reads `overrideMainActivity` flag from module.json and writes
 * module-flags.json so generate-project.js can skip default MainActivity.
 *
 * Usage: node install-custom-modules.js <buildId>
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const fetch = require("node-fetch");

const BUILD_ID = process.argv[2];
const BACKEND_URL = process.env.BACKEND_URL;
const SECRET = process.env.WEBHOOK_SECRET;

if (!BUILD_ID || !BACKEND_URL || !SECRET) {
  console.error("Missing BUILD_ID, BACKEND_URL or WEBHOOK_SECRET");
  process.exit(1);
}

// Find java source directory
function findJavaDir(root) {
  const base = path.join(root, "app/src/main/java");
  if (!fs.existsSync(base)) return null;
  const dirs = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { dirs.push(p); walk(p); }
    }
  }
  walk(base);
  return dirs.length > 0 ? dirs[dirs.length - 1] : base;
}

const PROJECT_ROOT = process.argv[3] || "android-project";
const javaDir = findJavaDir(PROJECT_ROOT);
const resDir = path.join(PROJECT_ROOT, "app/src/main/res");
const assetsDir = path.join(PROJECT_ROOT, "app/src/main/assets");

if (!javaDir) {
  console.error("Could not find java directory");
  process.exit(1);
}
console.log("Java dir:", javaDir);

// ═══════════════════════════════════════════════════════════════
// Security scan
// ═══════════════════════════════════════════════════════════════
const FORBIDDEN = [
  /Runtime\.getRuntime\(\)\.exec/,
  /ProcessBuilder/,
  /System\.exit/,
  /System\.getenv\(/,
  /\.deleteRecursively\(\)/,
];

function scan(content, file) {
  for (const p of FORBIDDEN) {
    if (p.test(content)) {
      throw new Error(`Forbidden pattern in ${file}: ${p}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Install one module
// ═══════════════════════════════════════════════════════════════
async function installModule(moduleId, cfg) {
  console.log(`\n→ Installing module: ${moduleId}`);

  const url = `${BACKEND_URL}/api/internal/module/${BUILD_ID}/${moduleId}`;
  const res = await fetch(url, { headers: { "X-Internal-Secret": SECRET } });
  if (!res.ok) {
    console.error(`  ✗ Fetch failed: ${res.status}`);
    return null;
  }

  const { base64, name, size } = await res.json();
  console.log(`  ✓ Fetched: ${name} (${Math.round(size / 1024)} KB)`);

  const tmpDir = path.join(process.cwd(), `.mod-${moduleId}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const zipPath = path.join(tmpDir, "module.zip");
  fs.writeFileSync(zipPath, Buffer.from(base64, "base64"));
  execSync(`unzip -q -o "${zipPath}" -d "${tmpDir}/x"`, { stdio: "inherit" });

  let srcDir = path.join(tmpDir, "x");
  const entries = fs.readdirSync(srcDir);
  if (entries.length === 1 && fs.statSync(path.join(srcDir, entries[0])).isDirectory()) {
    srcDir = path.join(srcDir, entries[0]);
  }

  // Validate module.json
  const metaPath = path.join(srcDir, "module.json");
  if (!fs.existsSync(metaPath)) {
    console.error("  ✗ Missing module.json");
    return null;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  console.log(`  ✓ Module: ${meta.name} v${meta.version}`);

  // ⭐ Write override flag if declared
  if (meta.overrideMainActivity === true) {
    const flagsPath = path.join(process.cwd(), "module-flags.json");
    let flags = {};
    if (fs.existsSync(flagsPath)) {
      try { flags = JSON.parse(fs.readFileSync(flagsPath, "utf8")); }
      catch { flags = {}; }
    }
    flags.overrideMainActivity = true;
    flags.moduleName = meta.name;
    fs.writeFileSync(flagsPath, JSON.stringify(flags, null, 2));
    console.log(`  ⚑ Module "${meta.name}" overrides MainActivity`);
  }

  // Install Kotlin files
  const ktFiles = fs.readdirSync(srcDir).filter(f => f.endsWith(".kt"));
  for (const f of ktFiles) {
    let content = fs.readFileSync(path.join(srcDir, f), "utf8");
    scan(content, f);
    content = content
      .replace(/{PACKAGE_NAME}/g, cfg.packageName)
      .replace(/{APP_NAME}/g, cfg.appName)
      .replace(/{THEME_COLOR}/g, cfg.themeColor);
    fs.writeFileSync(path.join(javaDir, f), content);
    console.log(`  ✓ Installed: ${f}`);
  }

  // Layout files
  const layoutSrc = path.join(srcDir, "layout");
  if (fs.existsSync(layoutSrc)) {
    const layoutDest = path.join(resDir, "layout");
    fs.mkdirSync(layoutDest, { recursive: true });
    for (const f of fs.readdirSync(layoutSrc)) {
      let content = fs.readFileSync(path.join(layoutSrc, f), "utf8");
      content = content.replace(/{PACKAGE_NAME}/g, cfg.packageName);
      fs.writeFileSync(path.join(layoutDest, f), content);
    }
    console.log(`  ✓ Layouts installed`);
  }

  // Drawable files
  const drawableSrc = path.join(srcDir, "drawable");
  if (fs.existsSync(drawableSrc)) {
    const drawableDest = path.join(resDir, "drawable");
    fs.mkdirSync(drawableDest, { recursive: true });
    for (const f of fs.readdirSync(drawableSrc)) {
      fs.copyFileSync(path.join(drawableSrc, f), path.join(drawableDest, f));
    }
    console.log(`  ✓ Drawables installed`);
  }

  // Values files (strings.xml, colors.xml, etc.)
  const valuesSrc = path.join(srcDir, "values");
  if (fs.existsSync(valuesSrc)) {
    const valuesDest = path.join(resDir, "values");
    fs.mkdirSync(valuesDest, { recursive: true });
    for (const f of fs.readdirSync(valuesSrc)) {
      let content = fs.readFileSync(path.join(valuesSrc, f), "utf8");
      content = content.replace(/{PACKAGE_NAME}/g, cfg.packageName);
      // Merge with existing? For now just write (may override)
      fs.writeFileSync(path.join(valuesDest, f), content);
    }
    console.log(`  ✓ Values installed`);
  }

  // assets/ files
  const assetsSrc = path.join(srcDir, "assets");
  if (fs.existsSync(assetsSrc)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const f of fs.readdirSync(assetsSrc)) {
      const s = path.join(assetsSrc, f);
      const d = path.join(assetsDir, f);
      if (fs.statSync(s).isDirectory()) {
        execSync(`cp -r "${s}" "${d}"`);
      } else {
        fs.copyFileSync(s, d);
      }
    }
    console.log(`  ✓ Assets installed`);
  }

  // Collect dependencies
  let deps = [];
  const depsFile = path.join(srcDir, "deps.gradle");
  if (fs.existsSync(depsFile)) {
    deps = fs.readFileSync(depsFile, "utf8")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("//"));
    console.log(`  ✓ Found ${deps.length} dependencies`);
  }

  // Manifest fragment
  let manifest = "";
  const manifestFile = path.join(srcDir, "manifest.xml");
  if (fs.existsSync(manifestFile)) {
    manifest = fs.readFileSync(manifestFile, "utf8")
      .replace(/{PACKAGE_NAME}/g, cfg.packageName);
    console.log(`  ✓ Manifest fragment: ${manifest.length} chars`);
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { deps, manifest };
}

// ═══════════════════════════════════════════════════════════════
// Apply deps + manifest fragments to project
// ═══════════════════════════════════════════════════════════════
function applyDepsToGradle(allDeps) {
  if (allDeps.length === 0) return;

  const gradlePath = path.join(PROJECT_ROOT, "app/build.gradle");
  let content = fs.readFileSync(gradlePath, "utf8");

  const depsBlock = allDeps.map(d => `  ${d}`).join("\n");
  const marker = "dependencies {";

  if (content.includes(marker)) {
    content = content.replace(
      marker,
      `${marker}\n  // ─── Module dependencies ───\n${depsBlock}\n`
    );
    fs.writeFileSync(gradlePath, content);
    console.log(`✓ Applied ${allDeps.length} deps to app/build.gradle`);
  }
}

function applyManifestFragments(fragments) {
  if (fragments.length === 0) return;

  const manifestPath = path.join(PROJECT_ROOT, "app/src/main/AndroidManifest.xml");
  let content = fs.readFileSync(manifestPath, "utf8");

  const combined = fragments.join("\n  ");

  // Insert before </application>
  content = content.replace(
    "</application>",
    `\n  ${combined}\n  </application>`
  );

  fs.writeFileSync(manifestPath, content);
  console.log(`✓ Applied ${fragments.length} manifest fragments`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
(async () => {
  try {
    const listRes = await fetch(
      `${BACKEND_URL}/api/internal/modules/${BUILD_ID}`,
      { headers: { "X-Internal-Secret": SECRET } }
    );
    if (!listRes.ok) {
      console.log("No custom modules for this build");
      return;
    }
    const { modules } = await listRes.json();
    if (!modules || modules.length === 0) {
      console.log("No custom modules for this build");
      return;
    }

    const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));

    const allDeps = new Set();
    const allManifests = [];

    for (const mod of modules) {
      const result = await installModule(mod.id, cfg);
      if (result) {
        result.deps.forEach(d => allDeps.add(d));
        if (result.manifest) allManifests.push(result.manifest);
      }
    }

    // Apply deps + manifest
    applyDepsToGradle(Array.from(allDeps));
    applyManifestFragments(allManifests);

    console.log(`\n✅ Installed ${modules.length} custom module(s)`);
    console.log(`   Deps: ${allDeps.size} | Manifest fragments: ${allManifests.length}`);
  } catch (err) {
    console.error("Install failed:", err.message);
    process.exit(1);
  }
})();
