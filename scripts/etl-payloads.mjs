// payloads:sync — install payload collections into <dataDir>/payloads without
// bundling them in the app repo. Offline-first: local sibling repo wins; remote
// is only fetched when no valid local copy exists. No new deps (fs + fetch).
//
// Resolution order for the source:
//   1. sibling repo <repo>/../9router-payloads (manifest verified)
//   2. remotes from ~/.9router/payloads.json — [{"name","url"}] tar.gz candidates
//   3. builtin fail-open: leave everything to the in-repo loader fallback
//
// Target: <dataDir>/payloads  + marker: <dataDir>/payloads/.9router-jailbreak-dir
// Idempotent: re-run only rewrites files whose manifest sha256 differs.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dirname, "..");
// NOTE: matches the loader (open-sse/payload/jailbreakPayloads.js) — env var is
// DATA_DIR (not 9ROUTER_DATA_DIR) and the marker lives INSIDE the payloads dir:
// <dataDir>/payloads/.9router-jailbreak-dir, empty content = use that dir.
const DATA_DIR = process.env["DATA_DIR"] || join(homedir(), ".9router");
const TARGET = join(DATA_DIR, "payloads");
const MARKER = join(TARGET, ".9router-jailbreak-dir");
const MANIFEST = "manifest.json";

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function localManifest(dir) {
  const m = join(dir, MANIFEST);
  if (!existsSync(m)) return null;
  try { return JSON.parse(readFileSync(m, "utf8")); } catch { return null; }
}

// Verify a candidate: manifest present + every entry hash matches.
function verifyLocal(dir) {
  const man = localManifest(dir);
  if (!man || !Array.isArray(man) || !man.length) return false;
  return man.every((e) => {
    const p = join(dir, e.path);
    return existsSync(p) && sha256(p) === e.sha256;
  });
}

function siblings() {
  let dir = REPO_ROOT;
  for (let i = 0; i < 3; i++) {
    dir = join(dir, "..");
    if (verifyLocal(join(dir, "9router-payloads"))) return join(dir, "9router-payloads");
  }
  return null;
}

// Remote candidates from user config (~/.9router/payloads.json):
// [{"name":"origin","url":"https://.../9router-payloads/archive/refs/heads/main.tar.gz"}]
function remotes() {
  const p = join(DATA_DIR, "payloads.json");
  if (!existsSync(p)) return [];
  try {
    const list = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(list) ? list.filter((r) => r && r.url) : [];
  } catch { return []; }
}

async function downloadTar(tarUrl, dest) {
  const res = await fetch(tarUrl);
  if (!res.ok) throw new Error(`fetch ${tarUrl}: ${res.status}`);
  const tmp = join(tmpdir(), `9router-payloads-${Date.now()}.tar.gz`);
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  execSync(`tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(dest)} --strip-components=1`, { stdio: "pipe" });
  rmSync(tmp, { force: true });
}

// Copy manifest-listed files that differ; prune stale files. Returns stats.
function syncInto(fromDir) {
  const man = localManifest(fromDir);
  mkdirSync(TARGET, { recursive: true });
  let changed = 0;
  for (const e of man) {
    const dst = join(TARGET, e.path);
    if (existsSync(dst) && sha256(dst) === e.sha256) continue;
    mkdirSync(dst.slice(0, dst.lastIndexOf(sep)), { recursive: true });
    writeFileSync(dst, readFileSync(join(fromDir, e.path)));
    changed++;
  }
  // prune target files the manifest no longer lists
  let pruned = 0;
  const want = new Set(man.map((e) => e.path));
  (function walk(d) {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else {
        const rel = relative(TARGET, p).split(sep).join("/");
        if (!want.has(rel) && rel !== MANIFEST && rel !== ".9router-jailbreak-dir" && !rel.startsWith("scripts/")) {
          rmSync(p); pruned++;
        }
      }
    }
  })(TARGET);
  writeFileSync(join(TARGET, MANIFEST), readFileSync(join(fromDir, MANIFEST)));
  writeFileSync(MARKER, ""); // loader: empty marker = dir is TARGET itself
  return { total: man.length, changed, pruned, target: TARGET };
}

// ---- main -----------------------------------------------------------------
const local = siblings();
if (local) {
  console.log(`Local payloads repo verified: ${local}`);
  console.log(syncInto(local));
  process.exit(0);
}
for (const r of remotes()) {
  try {
    console.log(`Trying remote ${r.name ?? "remote"}: ${r.url}`);
    rmSync(TARGET, { force: true, recursive: true });
    mkdirSync(TARGET, { recursive: true });
    await downloadTar(r.url, TARGET);
    if (!verifyLocal(TARGET)) throw new Error("downloaded manifest missing or checksum mismatch");
    console.log(syncInto(TARGET));
    process.exit(0);
  } catch (e) {
    console.error(`  failed: ${e.message}`);
    rmSync(TARGET, { force: true, recursive: true });
  }
}
// Fail-open: no local, no remote — loader falls back to in-repo/sibling path.
if (existsSync(MARKER)) unlinkSync(MARKER);
console.log("No payload source available (offline). Loader falls back to in-repo collections.");
