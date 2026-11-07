// External jailbreak payload registry — ingests prompt files from the
// AI-Jailbreaks and BlackFriday-GPTs-Prompts collections and registers
// them as pinned G0DM0D3 variants.
//
// Why file-based: the strong prompts from those collections are large
// (8KB–70KB+) and model-specific (Opus-4.8, NYX multi-AI, Cronus, Bladwin,
// RAGE GLM, etc.). Embedding them as JS string literals bloats every
// bundle chunk that imports godmodePayloads.js. File reads happen once at
// module load (sync, best-effort, fail-open) and are cached in memory.
//
// Resolution rules (checked in order, first hit wins):
//   1. 9ROUTER_JAILBREAK_DIR env var → use that dir directly
//   2. In-repo copy: <repo>/AI-Jailbreaks + <repo>/BlackFriday-GPTs-Prompts
//      (shipped with the GitHub repo + npm tarball so f:* variants resolve
//      out-of-the-box for everyone)
//   3. Sibling dir: <repo>/../AI-Jailbreaks etc. (local dev layout where the
//      collections live next to 9router/)
//   9ROUTER_JAILBREAK_DISABLE=1 → register nothing, registry stays empty


import os from "node:os";
import { readFileSync, existsSync, readdirSync, statSync, unlinkSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// import.meta.url is only valid in the source tree. Under a Next.js
// standalone bundle the chunk is minified and import.meta.url may point at a
// Linux build path that does not exist on Windows — fileURLToPath throws
// "File URL path must be absolute" and the whole module 500s on any request
// that touches it. Resolve defensively: try the URL, fall back to __dirname
// (CJS interop) or to process.cwd() so the directory walk below still works.
function resolveThisDir() {
  // fileURLToPath either returns a usable path or throws (Windows + a
  // cross-OS build URL). On success we still verify it is on a platform
  // root: a Linux path resolved on a non-Linux host is useless to the walk.
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      const p = fileURLToPath(import.meta.url);
      if (p && (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p))) return p;
    }
  } catch {
    // fall through — cross-OS URL on a different host
  }
  try {
    if (typeof __dirname === "string") return __dirname;
  } catch {
    // ignore
  }
  return process.cwd();
}
const THIS_DIR = resolveThisDir();
// open-sse/rtk → open-sse → 9router → special
const REPO_ROOT = join(THIS_DIR, "..", "..");
// In-repo copy takes priority; fall back to the sibling dir (local dev).
// 9ROUTER_JAILBREAK_DIR overrides both. When bundled (Next.js standalone),
// import.meta.url points at the bundled chunk, so we walk up to find the
// directory that actually contains AI-Jailbreaks/.
function resolveBaseDir() {
  if (process.env["9ROUTER_JAILBREAK_DIR"]) return process.env["9ROUTER_JAILBREAK_DIR"];
  // ETL extraction target: postinstall unpacks the shipped archive into
  // <dataDir>/payloads/, which contains AI-Jailbreaks/ + BlackFriday-GPTs-Prompts/.
  // Prefer it over the in-bundle copy so payloads live outside the npm-owned
  // node_modules (Windows EBUSY-free updates + no tarball bloat).
  try {
    const dataDir =
      process.env["DATA_DIR"] ||
      (process.platform === "win32"
        ? join(process.env["APPDATA"] || join(os.homedir(), "AppData", "Roaming"), "9router")
        : join(os.homedir(), ".9router"));
    const marker = join(dataDir, "payloads", ".9router-jailbreak-dir");
    if (existsSync(marker)) {
      const dir = readFileSync(marker, "utf8").trim() || join(dataDir, "payloads");
      if (existsSync(join(dir, "AI-Jailbreaks")) || existsSync(join(dir, "BlackFriday-GPTs-Prompts"))) {
        return dir;
      }
    }
  } catch {
    // best-effort; fall through to in-bundle resolution
  }
  let dir = REPO_ROOT;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "AI-Jailbreaks"))) return dir;
    dir = join(dir, "..");
  }
  // Payload collections live in a sibling repo (special/9router-payloads),
  // not in this repo. Fall back to it so a plain dev checkout of both
  // siblings resolves without env overrides.
  dir = REPO_ROOT;
  for (let i = 0; i < 2; i++) {
    dir = join(dir, "..");
    if (existsSync(join(dir, "9router-payloads", "AI-Jailbreaks"))) {
      return join(dir, "9router-payloads");
    }
  }
  return REPO_ROOT;
}
const BASE_DIR = resolveBaseDir();

// Categories: how payloads are grouped in the developer-page selector.
// Every registered file gets one; built-in variants get one too.
//   coding     — code-gen / debugging / dev-env focused
//   pentest    — red-team / security research / bypass
//   creative   — roleplay / fiction / creative writing (non-NSFW)
//   general    — catch-all
//   nsfw key retired — focus is attacking / building / pentest; kept only so a
//   user-supplied 9ROUTER_JAILBREAK_DIR can still tag payloads "nsfw" harmlessly
export const PAYLOAD_CATEGORIES = {
  coding:   { label: "Coding",        icon: "💻" },
  pentest:  { label: "Red-Team",     icon: "🛡" },
  creative: { label: "Creative / RP", icon: "✍️" },
  general:  { label: "General",       icon: "⚙" },
  nsfw:     { label: "RP / NSFW",     icon: "🔥" }, // retired from selector; registry compat only
};

const COLLECTIONS = [
  {
    // AI-Jailbreaks — per-model, current-gen jailbreaks
    prefix: "ai",
    root: join(BASE_DIR, "AI-Jailbreaks"),
    // Map of stable variant id suffix → relative file path.
    // Hidden dirs (.Multi-AI) are included explicitly.
    files: [
      // Multi-AI / model-agnostic — all red-team
      { id: "nyx-v4", path: ".Multi-AI/NYX-V4.txt", cat: "pentest" },
      { id: "cronus", path: ".Multi-AI/Cronus.txt", cat: "pentest" },
      { id: "bladwin-67", path: ".Multi-AI/Bladwin67.txt", cat: "pentest" },
      { id: "potato", path: ".Multi-AI/Potato.txt", cat: "pentest" },
      // Claude family
      { id: "opus-4.8", path: "Claude/6.Opus-4.8.txt", cat: "pentest" },
      { id: "claude-sonnet-4.6", path: "Claude/5.Claude-Sonnet-4.6.txt", cat: "pentest" },
      { id: "antigravity-thinking", path: "Claude/3.Antigravity-sonnet-4.6-thinking-&-Opus-4.6-thinking.txt", cat: "pentest" },
      { id: "lens-v2", path: "Claude/4.LENS_v2.md", cat: "pentest" },
      { id: "bladwin-claude", path: "Claude/1.Bladwin-Claude-Version.txt", cat: "pentest" },
      { id: "claude-potato", path: "Claude/Potato.txt", cat: "pentest" },
      // GPT
      { id: "gpt-5.6-bladwin", path: "GPT/GPT-5.6.txt", cat: "coding" },
      // Grok
      { id: "grok-nyx", path: "Grok/Grok-(INSTRUCTION).txt", cat: "pentest" },
      // GLM
      { id: "glm-rage", path: "GLM/GLM-5.2.txt", cat: "pentest" },
      // DeepSeek
      { id: "deepseek-gothbreach", path: "Deepseek/deepseek.txt", cat: "pentest" },
      { id: "deepseek1", path: "Deepseek/deepseek1.txt", cat: "pentest" },
      // Gemini
      { id: "gemini-3.5-flash-lite", path: "Gemini/Gemini-3.5-Flash-Lite.txt", cat: "creative" },
      // Kimi
      { id: "kimi-k2.6-instant", path: "Kimi/Kimi-K2.6-Instant.txt", cat: "pentest" },
      // Mistral
      { id: "mistral", path: "Mistral/Mistral.txt", cat: "general" },
      // OpenCode
      { id: "opencode-nyx", path: "Opencode/NYX-V4.txt", cat: "pentest" },
      // Qwen
      { id: "qwen-3.8-max-preview", path: "Qwen/Qwen-3.8-Max-Preview.txt", cat: "general" },
    ],
  },
  {
    // BlackFriday — classic DAN-era, GPT-4o generation
    prefix: "bf",
    root: join(BASE_DIR, "BlackFriday-GPTs-Prompts", "gpts"),
    files: [
      { id: "un-ethical-ai", path: "un-ethical-ai.md", cat: "pentest" },
      { id: "manipulation-dan-v13", path: "manipulation-gpt-x-dan-v13.md", cat: "pentest" },
      { id: "dev-mode", path: "chatgpt-jailbreak-dev-mode.md", cat: "coding" },
      // Curated from 8700 gpts — security / hacking / exploit
      { id: "blackhat-programmer", path: "blackhat-programmer-v1.md", cat: "pentest" },
      { id: "blackhat-hacker", path: "blackhathacker.md", cat: "pentest" },
      { id: "unlimited-hacking", path: "unlimited-hacking-ai.md", cat: "pentest" },
      { id: "ultimate-hacking", path: "ultimate-hacking-ai-20-4.md", cat: "pentest" },
      { id: "coding-jailbreak", path: "coding-generator-jailbreak-70.md", cat: "coding" },
      { id: "codemaster-jailbreak", path: "codemaster-chatgpt-4-jailbreak.md", cat: "coding" },
      // Curated — meta-frameworks & structural carriers (unique approach, not just content payloads)
      { id: "dark-roleplay-v12", path: "dark-roleplay-v12-base.md", cat: "pentest" },
      { id: "dark-roleplay-v11", path: "dark-roleplay-v11-base.md", cat: "pentest" },
      { id: "rfc-framework", path: "rfc-jailbreak-framework-454.md", cat: "pentest" },
      { id: "s-dan", path: "s-dan-jailbreak.md", cat: "pentest" },
      // (nsfw roleplay gpts removed — focus is attacking / building / pentest)
    ],
  },  {
    // JailbreakHub-novel — imported novel payloads (from Jalil's JailbreakHub
    // dedupe). Auto-scanned recursively; ids derived from the file path.
    prefix: "jh",
    root: join(BASE_DIR, "JailbreakHub-novel"),
    autoscan: true,
    files: [],
  },
  {
    // Upstream-novel — imported by scripts/import-upstream.mjs in the
    // payloads repo (one subfolder per source repo). Auto-scanned.
    prefix: "up",
    root: join(BASE_DIR, "Upstream-novel"),
    autoscan: true,
    files: [],
  },
];

// "Claude/Opus 4.7/tut.txt" → "claude-opus-4-7-tut"
function slugify(rel) {
  return rel
    .replace(/\.(md|txt)$/i, "")
    .split("/")
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function walkAutoscan(dir, rel = [], out) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const sub = rel.concat(name.name);
    if (name.isDirectory()) walkAutoscan(join(dir, name.name), sub, out);
    else if (/\.(md|txt)$/i.test(name.name) && !/^readme|license|^1#$/i.test(name.name)) out.push({ path: sub.join("/"), id: slugify(sub.join("/")) });
  }
  return out;
}

const registry = new Map(); // id → payload string
const categories = new Map(); // id → category key

// Bumped on every registry refresh (custom payload create / rename / delete /
// recategorize). The payload-catalog route memoizes its response for a few
// seconds; without a version check a payload deleted right after a catalog
// read would keep appearing in the selector — a selection that no longer
// resolves anywhere — until that TTL expired.
let registryVersion = 0;
let externalPayloadsCache = { version: -1, rows: null };
const carrierFlags = new Map();
export function getPayloadRegistryVersion() {
  return registryVersion;
}

function readPayload(absPath) {
  try {
    if (!existsSync(absPath)) return null;
    const text = readFileSync(absPath, "utf8").trim();
    if (!text) return null;
    return text;
  } catch {
    return null;
  }
}

// The first-line `cat: <key>` flag is loader metadata, not payload text. The
// registry parses it into `categories`, and every caller that wants the
// payload body (prompt injection, the dashboard editor, the size shown in the
// table) must see the file WITHOUT it — otherwise `cat: general` rides along
// inside the prompt sent to the model. Strip it on read; the file on disk
// keeps the flag so the category survives a restart.
//
// Declared above loadRegistry() on purpose: the loader calls this at module
// evaluation time, and a `const` further down would be in its TDZ (the throw
// would be swallowed by the custom-dir try/catch and every custom payload
// would silently vanish from the registry).
//
// Only a real category key counts as the flag — a payload whose first lines
// happen to read "cat: …" as prose must survive untouched.
const CAT_FLAG_LINE = new RegExp(
  `^\\s*cat:\\s*(${Object.keys(PAYLOAD_CATEGORIES).join("|")})\\s*$`,
  "i"
);

function stripCategoryFlag(text) {
  if (!text) return "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  // The loader accepts the flag within the first three lines; strip it from
  // the same window so write + read stay symmetric.
  const idx = lines.slice(0, 3).findIndex((l) => CAT_FLAG_LINE.test(l));
  if (idx === -1) return text;
  lines.splice(idx, 1);
  // A flag on its own line usually leaves a blank separator behind.
  if (idx === 0 && lines.length && lines[0].trim() === "") lines.shift();
  return lines.join(eol);
}

function loadRegistry() {
  if (process.env["9ROUTER_JAILBREAK_DISABLE"] === "1") return;
  for (const coll of COLLECTIONS) {
    if (!existsSync(coll.root)) continue;
    const files = coll.autoscan ? walkAutoscan(coll.root, [], []) : coll.files;
    for (const entry of files) {
      const abs = join(coll.root, entry.path);
      const text = readPayload(abs);
      if (text) {
        const id = `f:${coll.prefix}:${entry.id}`;
        registry.set(id, text);
        categories.set(id, entry.cat || coll.cat || "general");
      }
    }
  }
  // User-managed custom payloads: <dataDir>/custom-payloads/**.md|.txt
  // Optional per-file category via first line `cat: pentest` (default general).
  const customDir = getCustomDir();
  try {
    if (existsSync(customDir)) {
      for (const f of walkAutoscan(customDir, [], [])) {
        const text = readPayload(join(customDir, f.path));
        if (!text) continue;
        const m = text.split(/\r?\n/, 3).find((l) => /^cat:\s*\w+/i.test(l));
        const id = `f:custom:${f.id}`;
        registry.set(id, stripCategoryFlag(text));
        categories.set(id, m?.toLowerCase().match(/cat:\s*(\w+)/)?.[1] || "general");
      }
    }
  } catch {
    // custom dir unreadable — keep shipped payloads only
  }
}

loadRegistry();

// Re-scan just <dataDir>/custom-payloads/ after the dashboard writes/renames/
// categorizes a custom payload, so the running process picks up CRUD changes
// without a restart. Same fail-open contract as loadRegistry above: custom-
// payloads-only — the shipped collections keep whatever they loaded at import.
export function refreshCustomPayloadRegistry() {
  const customDir = getCustomDir();
  // Count the refresh even if the re-scan below fails: the registry did change
  // (entries were dropped), so any cached catalog built from it is stale.
  registryVersion += 1;
  externalPayloadsCache = { version: -1, rows: null };
  // Avoid Array.from on the live map: delete while iterating via for..of keys.
  for (const id of registry.keys()) {
    if (!id.startsWith("f:custom:")) continue;
    registry.delete(id);
    categories.delete(id);
    carrierFlags.delete(id);
  }
  try {
    if (existsSync(customDir)) {
      for (const f of walkAutoscan(customDir, [], [])) {
        const text = readPayload(join(customDir, f.path));
        if (!text) continue;
        // One strip pass: reuse result for body, size, and category detection.
        const m = text.split(/\r?\n/, 3).find((l) => /^cat:\s*\w+/i.test(l));
        const id = `f:custom:${f.id}`;
        registry.set(id, stripCategoryFlag(text));
        categories.set(id, m?.toLowerCase().match(/cat:\s*(\w+)/)?.[1] || "general");
      }
    }
  } catch {
    // custom dir unreadable — registry keeps whatever scanned before
  }
}

// Directory for user-managed custom payloads (this module also registers
// them, same lifecycle as the shipped collections).
function resolveDataDir() {
  if (process.env["DATA_DIR"]) return process.env["DATA_DIR"];
  if (process.platform === "win32") {
    return join(process.env["APPDATA"] || join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return join(os.homedir(), ".9router");
}
export function getCustomDir() {
  return join(resolveDataDir(), "custom-payloads");
}

export { stripCategoryFlag as stripCustomPayloadFlag };
export { slugify as customSlugify };


// id -> file row for the /api/developer/custom-payload list endpoint
export function getCustomPayloads() {
  const dir = getCustomDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of walkAutoscan(dir, [], [])) {
    const abs = join(dir, f.path);
    let raw = "";
    try { raw = readPayload(abs) || ""; } catch { continue; }
    if (!raw) continue;
    // Parse the flag from the raw file, report the size of the payload body.
    const m = raw.split(/\r?\n/, 3).find((l) => /^cat:\s*\w+/i.test(l));
    const text = stripCategoryFlag(raw);
    out.push({
      id: `f:custom:${f.id}`,
      file: f.path,
      chars: text.length,
      updated: statSync(abs).mtimeMs,
      // Category = first-line `cat: <key>` (loader metadata), else general.
      cat: m?.toLowerCase().match(/cat:\s*(\w+)/)?.[1] || "general",
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function findCustomRow(id) {
  const needle = String(id || "");
  if (!needle.startsWith("f:custom:")) return null;
  const rel = needle.slice("f:custom:".length);
  if (!rel) return null;
  const dir = getCustomDir();
  for (const ext of [".md", ".txt"]) {
    const abs = join(dir, `${rel}${ext}`);
    if (!existsSync(abs)) continue;
    let raw = "";
    try { raw = readPayload(abs) || ""; } catch { return null; }
    if (!raw) return null;
    const m = raw.split(/\r?\n/, 3).find((l) => /^cat:\s*\w+/i.test(l));
    const text = stripCategoryFlag(raw);
    return {
      id: needle,
      file: `${rel}${ext}`,
      chars: text.length,
      updated: statSync(abs).mtimeMs,
      cat: m?.toLowerCase().match(/cat:\s*(\w+)/)?.[1] || "general",
      abs,
      text,
    };
  }
  // Fallback for nested/legacy paths: scan once only when direct lookup misses.
  const row = getCustomPayloads().find((r) => r.id === needle);
  if (!row) return null;
  const abs = join(dir, row.file);
  let raw = "";
  try { raw = readPayload(abs) || ""; } catch { raw = ""; }
  return { ...row, abs, text: stripCategoryFlag(raw) };
}

export function getCustomPayload(id) {
  const row = findCustomRow(id);
  if (!row) return null;
  const { abs, ...rest } = row;
  void abs;
  return rest;
}

export function deleteCustomPayload(id) {
  if (!String(id).startsWith("f:custom:")) return false;
  const row = findCustomRow(id);
  if (!row) return false;
  try { unlinkSync(row.abs || join(getCustomDir(), row.file)); return true; } catch { return false; }
}
export function getExternalPayloads() {
  if (externalPayloadsCache.version === registryVersion && externalPayloadsCache.rows) {
    return externalPayloadsCache.rows;
  }
  const rows = [];
  for (const [id, text] of registry.entries()) {
    rows.push({ id, chars: text.length, cat: categories.get(id) || "general" });
  }
  externalPayloadsCache = { version: registryVersion, rows };
  return rows;
}

export function getPayloadCategory(id) {
  return categories.get(id) || "general";
}

export function getExternalPayload(id) {
  return registry.get(id) || null;
}

// Carrier detection is a full-text regex sweep over every registered payload.
// The texts are immutable for the life of the process (read once by
// loadRegistry at module load), so the answer for a given id can never
// change — memoizing it keeps the catalog route from re-scanning all payloads
// on every request. `detect` is injected by the caller because
// payloadCatalog.js imports this module and would otherwise form a cycle.
export function isExternalPayloadCarrier(id, detect) {
  if (carrierFlags.has(id)) return carrierFlags.get(id);
  const marker = detect(registry.get(id) || "");
  carrierFlags.set(id, marker);
  return marker;
}

// ── Custom payload edit helpers (dashboard /dashboard/custom-payloads) ──
//
// The id IS the filename slug, so "rename" = rename the file. Keeps the
// extension, slugifies the stem with the same rules as the upload path
// (the label shown in the Global Injection dropdown is derived from the id).
// All filesystem work is plain Node — portable across Linux/macOS/Windows.
const CUSTOM_WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]\d*|lpt[1-9]\d*)$/i;

const CUSTOM_CATS = new Set(Object.keys(PAYLOAD_CATEGORIES));

function findCustomFile(id) {
  const row = findCustomRow(id);
  if (!row) return null;
  return { row, abs: row.abs || join(getCustomDir(), ...row.file.split("/")) };
}

// Rename f:custom:<x> → f:custom:<new>. Returns the new id, or null when the
// payload is unknown / the name is unusable / the target already exists.
export function renameCustomPayload(id, rawName) {
  const hit = findCustomFile(id);
  if (!hit) return null;
  const stem = String(rawName || "").replace(/\.(md|txt)?$/i, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|[-.]+$/g, "").slice(0, 72);
  if (!stem || !/[a-z0-9]/.test(stem)) return null;
  const safe = CUSTOM_WIN_RESERVED.test(stem) ? `${stem}-file` : stem;
  const ext = (hit.row.file.match(/\.(md|txt)$/i)?.[0] || ".md").toLowerCase();
  // The new file may live in a different subfolder than the old one — build
  // the target from the old relative path so nesting is preserved.
  const segs = hit.row.file.split("/");
  segs[segs.length - 1] = `${safe}${ext}`;
  const nextRel = segs.join("/");
  const nextAbs = join(getCustomDir(), ...nextRel.split("/"));
  if (nextAbs === hit.abs) return hit.row.id; // noop rename — same name
  if (existsSync(nextAbs)) return null; // id would collide
  try {
    renameSync(hit.abs, nextAbs);
  } catch {
    return null;
  }
  // renameSync is atomic-ish but on Windows a failed rename can leave the old
  // file behind — verify before reporting the new id.
  return existsSync(nextAbs) ? `f:custom:${slugify(nextRel)}` : null;
}

// Set the loader category by (re)writing the first-line `cat: <key>` flag the
// registry already parses (see loadRegistry). Default when unset: general.
export function setCustomPayloadCat(id, cat) {
  const hit = findCustomFile(id);
  if (!hit) return null;
  const key = String(cat || "").toLowerCase().trim();
  if (!CUSTOM_CATS.has(key)) return null;
  const marker = `cat: ${key}`;
  const text = readPayload(hit.abs) || "";
  const lines = text.split(/\r?\n/);
  const existing = lines.findIndex((l) => /^cat:\s*\w+/i.test(l));
  if (existing === 0) lines[0] = marker; // replace in place
  else if (existing > 0) lines.splice(existing, 1); // remove misplaced marker…
  const body = lines.join("\n").replace(/^\s*\n+/, ""); // …no leading blank run
  const next = existing === 0 ? body : `${marker}\n${body}`;
  try {
    writeFileSync(hit.abs, next);
    return key;
  } catch {
    return null;
  }
}
