// dedupe-jailbreakhub.mjs — compare local payload collections against the
// JailbreakHub repo (github.com/lalipa2003-arch/JailbreakHub) so we only add
// genuinely novel payloads. Byte-level sha256 after normalization, not
// name-based (same names ≠ same content, and vice versa).
//
// Normalization: strip zero-width chars + repo-name watermark lines. Files
// that differ from a JailbreakHub file ONLY by watermark are "watermark-only"
// and skipped per policy ("watermark skipping — it's fine to keep it").
//
// Usage:
//   node scripts/dedupe-jailbreakhub.mjs            # report only
//   node scripts/dedupe-jailbreakhub.mjs --add      # copy novel into repo
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PAYLOAD_DIR = join(REPO_ROOT, "..", "9router-payloads");
const HUB_TARBALL = "https://codeload.github.com/lalipa2003-arch/JailbreakHub/tar.gz/refs/heads/main";
const COLLECTIONS = ["AI-Jailbreaks"]; // compare against our novel-collection sources

const decode = (b) => Buffer.from(b).toString("utf8");
const stripZW = (s) => s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "");
const WATERMARK_RE = /(lali|jailbreakhub|github\.com\/[\w.-]+\/[\w.-]+|www\.youtube\.com\/|\.git\b)/i;
const stripWatermark = (s) =>
  s.split(/\r?\n/).filter((l) => !WATERMARK_RE.test(l)).join("\n");

// eslint-disable-next-line no-unused-vars
function watermarkedOnly(a, b) {
  return a !== b && stripWatermark(a) === stripWatermark(b);
}

function sha(s) { return createHash("sha256").update(s).digest("hex"); }

// fetch + unpack JailbreakHub into tmp
const tmp = join(tmpdir(), "9router-dedupe-hub");
execSync(`rm -rf ${JSON.stringify(tmp)} && mkdir -p ${JSON.stringify(tmp)} && curl -sL ${HUB_TARBALL} | tar -xz -C ${JSON.stringify(tmp)} --strip-components=1`, { stdio: "pipe" });

function walk(dir, base = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base + e.name + "/"));
    else if (e.isFile() && /\.(md|txt)$/i.test(e.name)) out.push({ path: base + e.name, file: p });
  }
  return out;
}

const local = [];
for (const c of COLLECTIONS) {
  const dir = join(PAYLOAD_DIR, c);
  if (!existsSync(dir)) continue;
  local.push(...walk(dir, c + "/"));
}
// local normalized map: normalized-sha → path(s); plus raw-sha map
const localBySha = new Map();
for (const l of local) {
  const raw = decode(readFileSync(l.file));
  const s = sha(stripZW(raw));
  (localBySha.get(s) || localBySha.set(s, []).get(s)).push(l.path);
}

const hub = walk(tmp);
const report = { hubFiles: hub.length, novel: [], identical: [], watermarkOnly: [] };
const add = process.argv.includes("--add");
for (const h of hub) {
  const raw = decode(readFileSync(h.file));
  const s = sha(stripZW(raw));
  if (localBySha.has(s)) { report.identical.push(`${h.path} == ${localBySha.get(s)[0]}`); continue; }
  // watermark-only difference vs some local file?
  if (localBySha.has(sha(stripWatermark(stripZW(raw))))) { report.watermarkOnly.push(h.path); continue; }
  report.novel.push(h);
}

if (add) {
  const dest = join(PAYLOAD_DIR, "JailbreakHub-novel");
  for (const h of report.novel) {
    mkdirSync(join(dest, h.path.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(dest, h.path), readFileSync(h.file));
  }
  console.log(`copied ${report.novel.length} novel files → JailbreakHub-novel/`);
}
console.log(JSON.stringify({
  hubFiles: report.hubFiles, novel: report.novel.length,
  identical: report.identical.length, watermarkOnly: report.watermarkOnly.length,
}));
if (!add && report.novel.length) console.log(report.novel.slice(0, 25).map((n) => "  " + n.path).join("\n"));
console.log(`identical/wm totals above; full diff: run with --add to store novel files`);
