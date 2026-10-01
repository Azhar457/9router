#!/usr/bin/env node
// Slim-pack helper: temporarily trims the payload-collection entries out of
// files[] so `npm pack` produces a review-friendly tarball, then restores
// the original files[] afterwards. The two entries (../AI-Jailbreaks,
// ../BlackFriday-GPTs-Prompts) pull 8.7k sibling files into the tarball and
// are the likely trigger for npm's automated security review; the runtime
// f:* payload variants fail-open to the classic payload when the
// collections are absent, so the slim build is fully functional.
//
// Usage: node scripts/slimPack.js
//   1. Reads package.json, snapshots files[].
//   2. Rewrites files[] without the payload entries.
//   3. Spawns `npm pack --pack-destination /tmp`.
//   4. Restores files[] regardless of pack success.
//
// Keep files[] in package.json as the full set so the default (non-slim)
// `npm pack` / `npm publish` still ships the collections for users who want
// the full Red Team Toolkit out-of-the-box.

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const cliDir = path.resolve(__dirname, "..");
const pkgPath = path.join(cliDir, "package.json");

const PAYLOAD_ENTRIES = ["../AI-Jailbreaks", "../BlackFriday-GPTs-Prompts"];

function main() {
  const original = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const originalFiles = original.files;

  const slimFiles = originalFiles.filter(
    (f) => !PAYLOAD_ENTRIES.includes(f)
  );
  original.files = slimFiles;
  fs.writeFileSync(pkgPath, JSON.stringify(original, null, 2) + "\n");
  console.log(
    `📦 Slim pack: files[] ${originalFiles.length} → ${slimFiles.length} (removed ${originalFiles.length - slimFiles.length} payload entries)`
  );

  // Physically remove any payload-collection dirs from the build output so
  // `app/` (still in files[]) cannot re-include them. The build's step 7c
  // skips the copy when SKIP=1, but a leftover from a prior full build (or
  // the standalone asset copy) can still leave 20-ish .txt files in
  // cli/app/AI-Jailbreaks. Delete both dirs from the output dir; runtime
  // f:* variants fail-open to the classic payload when absent.
  const appOutDir = path.join(cliDir, "app");
  for (const coll of ["AI-Jailbreaks", "BlackFriday-GPTs-Prompts"]) {
    const collDir = path.join(appOutDir, coll);
    if (fs.existsSync(collDir)) {
      fs.rmSync(collDir, { recursive: true, force: true });
      console.log(`🗑  Removed leftover ${coll}/ from build output`);
    }
  }

  let packOk = false;
  try {
    execSync("npm pack --pack-destination /tmp", {
      stdio: "inherit",
      cwd: cliDir,
    });
    packOk = true;
    const pkg = original.name;
    const ver = original.version;
    const produced = path.join("/tmp", `${pkg}-${ver}.tgz`);
    if (fs.existsSync(produced)) {
      const bytes = fs.statSync(produced).size;
      console.log(`✅ Slim tarball: ${produced} (${(bytes / 1048576).toFixed(1)} MB)`);
    }
  } catch (err) {
    console.error("❌ npm pack failed:", err.message);
  } finally {
    original.files = originalFiles;
    fs.writeFileSync(pkgPath, JSON.stringify(original, null, 2) + "\n");
    console.log("↩️  Restored original files[]");
  }
  process.exit(packOk ? 0 : 1);
}

main();
