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
  let dir = REPO_ROOT;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "AI-Jailbreaks"))) return dir;
    dir = join(dir, "..");
  }
  return REPO_ROOT;
}
const BASE_DIR = resolveBaseDir();

const COLLECTIONS = [
  {
    // AI-Jailbreaks — per-model, current-gen jailbreaks
    prefix: "ai",
    root: join(BASE_DIR, "AI-Jailbreaks"),
    // Map of stable variant id suffix → relative file path.
    // Hidden dirs (.Multi-AI) are included explicitly.
    files: [
      // Multi-AI / model-agnostic
      { id: "nyx-v4", path: ".Multi-AI/NYX-V4.txt" },
      { id: "cronus", path: ".Multi-AI/Cronus.txt" },
      { id: "bladwin-67", path: ".Multi-AI/Bladwin67.txt" },
      { id: "potato", path: ".Multi-AI/Potato.txt" },
      // Claude family
      { id: "opus-4.8", path: "Claude/6.Opus-4.8.txt" },
      { id: "claude-sonnet-4.6", path: "Claude/5.Claude-Sonnet-4.6.txt" },
      { id: "antigravity-thinking", path: "Claude/3.Antigravity-sonnet-4.6-thinking-&-Opus-4.6-thinking.txt" },
      { id: "lens-v2", path: "Claude/4.LENS_v2.md" },
      { id: "bladwin-claude", path: "Claude/1.Bladwin-Claude-Version.txt" },
      // GPT
      { id: "gpt-5.6-bladwin", path: "GPT/GPT-5.6.txt" },
      // Grok
      { id: "grok-nyx", path: "Grok/Grok-(INSTRUCTION).txt" },
      // GLM
      { id: "glm-rage", path: "GLM/GLM-5.2.txt" },
      // DeepSeek
      { id: "deepseek-gothbreach", path: "Deepseek/deepseek.txt" },
    ],
  },
  {
    // BlackFriday — classic DAN-era, GPT-4o generation
    prefix: "bf",
    root: join(BASE_DIR, "BlackFriday-GPTs-Prompts", "gpts"),
    files: [
      { id: "un-ethical-ai", path: "un-ethical-ai.md" },
      { id: "manipulation-dan-v13", path: "manipulation-gpt-x-dan-v13.md" },
      { id: "dev-mode", path: "chatgpt-jailbreak-dev-mode.md" },
    ],
  },
];

const registry = new Map(); // id → payload string

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
      }
    }
  }
}

loadRegistry();

export function getExternalPayloads() {
  return Array.from(registry.entries()).map(([id, text]) => ({ id, chars: text.length }));
}

export function getExternalPayload(id) {
  return registry.get(id) || null;
}
