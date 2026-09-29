#!/usr/bin/env node
/**
 * Install custom modules from backend.
 *
 * Two modes:
 *   1. scan mode:    `node install-custom-modules.js <buildId> scan`
 *      → Fetches module list from backend
 *      → Extracts module.json from each
 *      → Writes module-flags.json (used by generate-project.js)
 *      → Doesn't touch android-project (which doesn't exist yet)
 *
 *   2. install mode: `node install-custom-modules.js <buildId>`
 *      → Requires android-project to exist
 *      → Extracts full module ZIPs
 *      → Copies Kotlin, layouts, drawables into project
 *      → Applies deps.gradle and manifest.xml
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const fetch = require("node-fetch");

const BUILD_ID = process.argv[2];
const MODE = process.argv[3] || "install"; // "scan" or "install"
const BACKEND_URL = process.env.BACKEND_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const PROJECT_ROOT = "android-project";

if (!BUILD_ID || !BACKEND_URL || !SECRET) {
  console.error("Missing BUILD_ID, BACKEND_URL or WEBHOOK_SECRET");
  process.exit(1);
}

console.log(`>>> install-custom-modules.js — mode: ${MODE}`);

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
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

async function fetchModuleList() {
  const url = `${BACKEND_URL}/api/internal/modules/${BUILD_ID}`;
  const res = await fetch(url, { headers: { "X-Internal-Secret": SECRET } });
  if (!res.ok) return [];
  const { modules } = await res.json();
  return modules || [];
}

async function fetchModuleZip(moduleId) {
  const url = `${BACKEND_URL}/api/internal/module/${BUILD_ID}/${moduleId}`;
  const res = await fetch(url, { headers: { "X-Internal-Secret": SECRET } });
  if (!res.ok) return null;
  return res.json(); // { base64, name, size }
}

function extractZip(base64, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, "module.zip");
  fs.writeFileSync(zipPath, Buffer.from(base64, "base64"));
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}/x"`, { stdio: "inherit" });
  fs.unlinkSync(zipPath);

  // Flatten if single wrapper folder
  let srcDir = path.join(destDir, "x");
  const entries = fs.readdirSync(srcDir);
  if (entries.length === 1 && fs.statSync(path.join(srcDir, entries[0])).isDirectory()) {
    srcDir = path.join(srcDir, entries[0]);
  }
  return srcDir;
}

// ═══════════════════════════════════════════════════════════════
// SCAN PHASE
// ═══════════════════════════════════════════════════════════════
async function runScan() {
  console.log("Mode: scan — will write module-flags.json only");

  const modules = await fetchModuleList();
  if (modules.length === 0) {
    console.log("No custom modules for this build");
    return;
  }

  console.log(`Found ${modules.length} module(s): ${modules.map(m => m.id).join(", ")}`);

  const flags = {
    overrideMainActivity: false,
    modules: [],
  };

  for (const mod of modules) {
    try {
      const data = await fetchModuleZip(mod.id);
      if (!data) continue;

      const tmpDir = path.join(process.cwd(), `.scan-${mod.id}`);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      const srcDir = extractZip(data.base64, tmpDir);

      const metaPath = path.join(srcDir, "module.json");
      if (!fs.existsSync(metaPath)) {
        console.warn(`  ✗ ${mod.id}: no module.json`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        continue;
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      console.log(`  ✓ ${meta.name} v${meta.version}`);

      flags.modules.push({
        id: mod.id,
        name: meta.name,
        version: meta.version,
        overrideMainActivity: meta.overrideMainActivity === true,
      });

      if (meta.overrideMainActivity === true) {
        flags.overrideMainActivity = true;
        console.log(`  ⚑ "${meta.name}" overrides MainActivity`);
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`  ✗ Scan ${mod.id} failed:`, e.message);
    }
  }

  fs.writeFileSync("module-flags.json", JSON.stringify(flags, null, 2));
  console.log("✓ Wrote module-flags.json");
  console.log("  overrideMainActivity:", flags.overrideMainActivity);
}

// ═══════════════════════════════════════════════════════════════
// INSTALL PHASE
// ═══════════════════════════════════════════════════════════════
const FORBIDDEN = [
  /Runtime\.getRuntime\(\)\.exec/,
  /ProcessBuilder/,
  /System\.exit/,
  /System\.getenv\(/,
  /\.deleteRecursively\(\)/,
];

function scanForThreats(content, file) {
  for (const p of FORBIDDEN) {
    if (p.test(content)) {
      throw new Error(`Forbidden pattern in ${file}: ${p}`);
    }
  }
}

async function installModuleIntoProject(modId, cfg, javaDir, resDir, assetsDir) {
  console.log(`\n→ Installing: ${modId}`);

  const data = await fetchModuleZip(modId);
  if (!data) {
    console.error(`  ✗ Fetch failed`);
    return null;
  }
  console.log(`  ✓ Fetched: ${data.name} (${Math.round(data.size / 1024)} KB)`);

  const tmpDir = path.join(process.cwd(), `.install-${modId}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const srcDir = extractZip(data.base64, tmpDir);

  const metaPath = path.join(srcDir, "module.json");
  if (!fs.existsSync(metaPath)) {
    console.error(`  ✗ Missing module.json`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return null;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  console.log(`  ✓ Module: ${meta.name} v${meta.version}`);

  // Kotlin files
  for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith(".kt"))) {
    let content = fs.readFileSync(path.join(srcDir, f), "utf8");
    scanForThreats(content, f);
    content = content
      .replace(/{PACKAGE_NAME}/g, cfg.packageName)
      .replace(/{APP_NAME}/g, cfg.appName)
      .replace(/{THEME_COLOR}/g, cfg.themeColor);
    fs.writeFileSync(path.join(javaDir, f), content);
    console.log(`  ✓ Kotlin: ${f}`);
  }

  // Layouts
  const layoutSrc = path.join(srcDir, "layout");
  if (fs.existsSync(layoutSrc)) {
    const layoutDest = path.join(resDir, "layout");
    fs.mkdirSync(layoutDest, { recursive: true });
    for (const f of fs.readdirSync(layoutSrc)) {
      let c = fs.readFileSync(path.join(layoutSrc, f), "utf8");
      c = c.replace(/{PACKAGE_NAME}/g, cfg.packageName);
      fs.writeFileSync(path.join(layoutDest, f), c);
    }
    console.log(`  ✓ Layouts`);
  }

  // Drawables
  const drawableSrc = path.join(srcDir, "drawable");
  if (fs.existsSync(drawableSrc)) {
    const drawableDest = path.join(resDir, "drawable");
    fs.mkdirSync(drawableDest, { recursive: true });
    for (const f of fs.readdirSync(drawableSrc)) {
      fs.copyFileSync(path.join(drawableSrc, f), path.join(drawableDest, f));
    }
    console.log(`  ✓ Drawables`);
  }

  // Values
  const valuesSrc = path.join(srcDir, "values");
  if (fs.existsSync(valuesSrc)) {
    const valuesDest = path.join(resDir, "values");
    fs.mkdirSync(valuesDest, { recursive: true });
    for (const f of fs.readdirSync(valuesSrc)) {
      let c = fs.readFileSync(path.join(valuesSrc, f), "utf8");
      c = c.replace(/{PACKAGE_NAME}/g, cfg.packageName);
      fs.writeFileSync(path.join(valuesDest, f), c);
    }
    console.log(`  ✓ Values`);
  }

  // Assets
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
    console.log(`  ✓ Assets`);
  }

  // Deps
  let deps = [];
  const depsFile = path.join(srcDir, "deps.gradle");
  if (fs.existsSync(depsFile)) {
    deps = fs.readFileSync(depsFile, "utf8")
      .split("\n").map(l => l.trim())
      .filter(l => l && !l.startsWith("//"));
    console.log(`  ✓ ${deps.length} deps`);
  }

  // Manifest fragment
  let manifest = "";
  const manifestFile = path.join(srcDir, "manifest.xml");
  if (fs.existsSync(manifestFile)) {
    manifest = fs.readFileSync(manifestFile, "utf8")
      .replace(/{PACKAGE_NAME}/g, cfg.packageName);
    console.log(`  ✓ Manifest fragment`);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return { deps, manifest };
}

function applyDepsToGradle(allDeps) {
  if (allDeps.length === 0) return;
  const gradlePath = path.join(PROJECT_ROOT, "app/build.gradle");
  let content = fs.readFileSync(gradlePath, "utf8");
  const depsBlock = allDeps.map(d => `  ${d}`).join("\n");
  const marker = "dependencies {";
  if (content.includes(marker)) {
    content = content.replace(
      marker,
      `${marker}\n  // ─── Module deps ───\n${depsBlock}\n`
    );
    fs.writeFileSync(gradlePath, content);
    console.log(`✓ Applied ${allDeps.length} deps`);
  }
}

function applyManifestFragments(fragments) {
  if (fragments.length === 0) return;
  const manifestPath = path.join(PROJECT_ROOT, "app/src/main/AndroidManifest.xml");
  let content = fs.readFileSync(manifestPath, "utf8");
  const combined = fragments.join("\n  ");
  content = content.replace(
    "</application>",
    `\n  ${combined}\n  </application>`
  );
  fs.writeFileSync(manifestPath, content);
  console.log(`✓ Applied ${fragments.length} manifest fragments`);
}

async function runInstall() {
  console.log("Mode: install — will extract & copy into android-project");

  if (!fs.existsSync(PROJECT_ROOT)) {
    console.error(`✗ ${PROJECT_ROOT} not found. Run generate-project.js first.`);
    process.exit(1);
  }

  const javaDir = findJavaDir(PROJECT_ROOT);
  if (!javaDir) {
    console.error("✗ Could not find java directory in project");
    process.exit(1);
  }
  console.log("Java dir:", javaDir);

  const resDir = path.join(PROJECT_ROOT, "app/src/main/res");
  const assetsDir = path.join(PROJECT_ROOT, "app/src/main/assets");

  const modules = await fetchModuleList();
  if (modules.length === 0) {
    console.log("No custom modules to install");
    return;
  }

  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));

  const allDeps = new Set();
  const allManifests = [];

  for (const mod of modules) {
    const result = await installModuleIntoProject(mod.id, cfg, javaDir, resDir, assetsDir);
    if (result) {
      result.deps.forEach(d => allDeps.add(d));
      if (result.manifest) allManifests.push(result.manifest);
    }
  }

  applyDepsToGradle(Array.from(allDeps));
  applyManifestFragments(allManifests);

  console.log(`\n✅ Installed ${modules.length} module(s)`);
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
(async () => {
  try {
    if (MODE === "scan") {
      await runScan();
    } else {
      await runInstall();
    }
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
