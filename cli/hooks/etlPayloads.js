#!/usr/bin/env node
// ETL load: at install time, extract the shipped payloads.tar.gz into the
// user data dir (~/.9router/payloads/) and record the dir in a marker file
// so the runtime can resolve it. This is the "Load" step of the ETL pack:
// the npm tarball carries one compressed archive + manifest instead of 8.7k
// loose payload files; install expands them to the user-writable data dir
// (outside the npm-owned node_modules, so updates don't fight locks).
//
// Fail-open: any error returns without throwing, matching the postinstall
// contract. Missing archive => no-op (runtime falls back to loose files in
// the repo/tarball if present, else classic payload).
//
// The marker file the runtime reads: <dataDir>/payloads/.9router-jailbreak-dir

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const appOutDir = path.join(cliDir, "app");

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router");
}

function hasArchive() {
  return fs.existsSync(path.join(appOutDir, "payloads.tar.gz"));
}

function ensureMarker(payloadDir) {
  try {
    fs.mkdirSync(payloadDir, { recursive: true });
    fs.writeFileSync(path.join(payloadDir, ".9router-jailbreak-dir"), payloadDir + "\n");
  } catch {
    /* best effort */
  }
}

function extract({ silent = false } = {}) {
  if (process.env["9ROUTER_JAILBREAK_DISABLE"] === "1") {
    if (!silent) console.log("[9router] payloads: 9ROUTER_JAILBREAK_DISABLE=1 — skipping");
    return false;
  }
  if (!hasArchive()) {
    if (!silent) console.log("[9router] payloads: no payloads.tar.gz shipped — skipping (loose-file fallback)");
    return false;
  }

  const dataDir = getDataDir();
  const payloadDir = path.join(dataDir, "payloads");
  const manifest = path.join(appOutDir, "payloads.manifest.json");

  // Skip if already extracted and matches the shipped manifest.
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const marker = path.join(payloadDir, ".payloads-extract.json");
    if (fs.existsSync(marker)) {
      try {
        const prev = JSON.parse(fs.readFileSync(marker, "utf8"));
        if (prev.sha === m.sha) {
          ensureMarker(payloadDir);
          if (!silent) console.log("[9router] payloads: already extracted — up to date");
          return true;
        }
      } catch {
        /* fall through to re-extract */
      }
    }
  }

  // Wipe the extract target for a clean expand.
  try {
    fs.rmSync(payloadDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  fs.mkdirSync(payloadDir, { recursive: true });

  const tarGz = path.join(appOutDir, "payloads.tar.gz");
  execSync(`tar -xzf "${tarGz}" -C "${payloadDir}"`, { stdio: "pipe" });

  // Write the marker + record the manifest sha for next install's dedupe.
  let sha = "";
  try {
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    sha = m.sha || "";
    fs.writeFileSync(path.join(payloadDir, ".payloads-extract.json"), JSON.stringify({ sha, at: new Date().toISOString() }));
  } catch {
    /* best effort */
  }

  ensureMarker(payloadDir);
  if (!silent) console.log(`[9router] payloads: extracted to ${payloadDir}`);
  return true;
}

module.exports = { extract, hasArchive, getDataDir };

if (require.main === module) {
  try {
    extract({ silent: false });
  } catch (e) {
    console.warn(`[9router] payloads extract skipped: ${e.message}`);
  }
  process.exit(0);
}
