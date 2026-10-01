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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
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
  },
];

const registry = new Map(); // id → payload string
const categories = new Map(); // id → category key

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

function loadRegistry() {
  if (process.env["9ROUTER_JAILBREAK_DISABLE"] === "1") return;
  for (const coll of COLLECTIONS) {
    if (!existsSync(coll.root)) continue;
    for (const entry of coll.files) {
      const abs = join(coll.root, entry.path);
      const text = readPayload(abs);
      if (text) {
        const id = `f:${coll.prefix}:${entry.id}`;
        registry.set(id, text);
        categories.set(id, entry.cat || "general");
      }
    }
  }
}

loadRegistry();

export function getExternalPayloads() {
  return Array.from(registry.entries()).map(([id, text]) => ({
    id,
    chars: text.length,
    cat: categories.get(id) || "general",
  }));
}

export function getExternalPayload(id) {
  return registry.get(id) || null;
}
