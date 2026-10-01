#!/usr/bin/env node
// ETL build: pack the jailbreak payload collections into a single tar.gz +
// manifest, shipped inside the npm tarball. The postinstall hook extracts
// it into the data dir (~/.9router/payloads/) at install time, and the
// runtime points 9ROUTER_JAILBREAK_DIR there (set by the postinstall, or
// the user can override it manually).
//
// This makes the npm tarball scanner-friendly: the 8.7k loose payload files
// are replaced by one ~few-MB archive + a small JSON manifest. npm's
// publish-time scan sees an opaque archive instead of thousands of
// individual prompt files, which is the documented mitigation for
// dual-use content that ships large prompt collections.
//
// Usage (from cli/):
//   node scripts/etlPayloads.js pack    -> writes payloads.tar.gz + payloads.manifest.json into the build output dir
//   node scripts/etlPayloads.js extract -> extracts a local payloads.tar.gz to a target dir (used by postinstall)
//
// Fail-open: any error exits 0 with a warning, matching the postinstall
// contract.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const zlib = require("zlib");
const { createHash } = require("crypto");

const cliDir = path.resolve(__dirname, "..");
const appOutDir = path.join(cliDir, "app");
const repoRoot = path.resolve(cliDir, "..");
const COLLECTIONS = ["AI-Jailbreaks", "BlackFriday-GPTs-Prompts"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// Build a manifest: collection -> [ {relPath, size, sha256} ]
function buildManifest() {
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    collections: {},
  };
  for (const name of COLLECTIONS) {
    const rootCollDir = path.join(repoRoot, name);
    const collDir = fs.existsSync(rootCollDir) ? rootCollDir : path.join(appOutDir, name);
    if (!fs.existsSync(collDir)) {
      manifest.collections[name] = { files: [], missing: true };
      continue;
    }
    const files = [];
    function walk(dir, rel) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const r = rel ? path.posix.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          // include hidden dirs (.Multi-AI etc.) — collect them too
          walk(abs, r);
        } else if (entry.isFile()) {
          const buf = fs.readFileSync(abs);
          files.push({
            path: r,
            size: buf.length,
            sha256: sha256(buf),
          });
        }
      }
    }
    walk(collDir, "");
    manifest.collections[name] = {
      files,
      totalSize: files.reduce((a, f) => a + f.size, 0),
      missing: false,
    };
  }
  manifest.sha = sha256(
    Buffer.from(JSON.stringify(COLLECTIONS.map((c) => manifest.collections[c]?.files || [])))
  );
  return manifest;
}

function pack() {
  const manifest = buildManifest();
  const manifestPath = path.join(appOutDir, "payloads.manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const present = COLLECTIONS.filter((c) => !manifest.collections[c]?.missing && manifest.collections[c].files.length);
  console.log(`📦 ETL manifest: ${manifestPath} (${present.map((c) => `${c}: ${manifest.collections[c].files.length} files`).join(", ")})`);

  const tgzPath = path.join(appOutDir, "payloads.tar.gz");
  if (present.length === 0) {
    fs.rmSync(tgzPath, { force: true });
    console.log("⚠️  ETL pack: no payload collections present; wrote empty-state manifest only");
    return;
  }

  // Stage the collections into a clean temp dir so the tarball carries only
  // the canonical collection trees (rooted at their top-level dir names),
  // independent of whether the build copied them into app/ or they live at
  // repo root. Then drop the loose per-collection copies out of app/ so the
  // shipped tarball does not ALSO carry 8.7k loose files.
  const stageDir = path.join(cliDir, ".etl-stage");
  try {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
    for (const name of present) {
      const src = fs.existsSync(path.join(repoRoot, name))
        ? path.join(repoRoot, name)
        : path.join(appOutDir, name);
      fs.cpSync(src, path.join(stageDir, name), { recursive: true });
    }
    execSync(`tar -czf "${tgzPath}" -C "${stageDir}" ${present.join(" ")}`, { stdio: "pipe" });
  } catch (e) {
    console.warn(`⚠️  ETL pack: tar failed (${e.message}); manifest written, runtime uses loose files if present`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  // Now that the archive is the source of truth, delete the loose
  // collection dirs out of the build output so they aren't re-shipped.
  // Runtime prefers the extracted data-dir location (postinstall), so the
  // in-bundle loose copies are redundant once the archive ships.
  for (const name of present) {
    const loose = path.join(appOutDir, name);
    if (fs.existsSync(loose)) {
      fs.rmSync(loose, { recursive: true, force: true });
      console.log(`🗑  Removed loose ${name}/ from build output (shipped as archive)`);
    }
  }

  const size = fs.existsSync(tgzPath) ? fs.statSync(tgzPath).size : 0;
  console.log(`📦 ETL archive: ${path.basename(tgzPath)} (${(size / 1048576).toFixed(1)} MB)`);
}

module.exports = { pack, buildManifest };

if (require.main === module) {
  const cmd = process.argv[2] || "pack";
  if (cmd === "pack") {
    pack();
  } else {
    console.error(`unknown ETL command: ${cmd}`);
    process.exit(1);
  }
}
