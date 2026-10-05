// Strix security-skill payload registry — loads skill markdown files from
// strix-payloads/ and registers them as `strix:*` payload entries, the same
// way jailbreakPayloads.js ingests AI-Jailbreaks / BlackFriday files.
//
// Why Strix: each skill file is a curated security-testing knowledge module
// (SQLi, XSS, k8s, OWASP playbooks…). We treat it as a context payload: the
// full markdown ships into the model's system prompt via the global-inject
// pipeline, so the model reasons about the user's target WITH that skill.
//
// Files live under <repo>/strix-payloads/ (in-repo, shipped with the tarball).
// 9ROUTER_STRIX_DIR overrides; 9ROUTER_STRIX_DISABLE=1 → register nothing.
// Sync read at module load, cached in memory — fail-open, same contract as
// jailbreakPayloads.js.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
// open-sse/rtk → open-sse → repo root
const REPO_ROOT = join(THIS_DIR, "..", "..");

function resolveStrixDir() {
  if (process.env["9ROUTER_STRIX_DIR"]) return process.env["9ROUTER_STRIX_DIR"];
  let dir = REPO_ROOT;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "strix-payloads"))) return dir;
    dir = join(dir, "..");
  }
  return REPO_ROOT;
}
const BASE_DIR = resolveStrixDir();

// Directory layout inside strix-payloads/.
const STRIX_GROUPS = [
  { cat: "vulnerabilities", dir: join("skills", "vulnerabilities") },
  { cat: "frameworks", dir: join("skills", "frameworks") },
  { cat: "cloud", dir: join("skills", "cloud") },
  { cat: "top-level", dir: "top-level-skills" },
];

/**
 * @typedef {object} StrixPayloadRow
 * @property {string} id  "strix:<cat>:<name>"
 * @property {string} cat
 * @property {string} name
 * @property {string} description  front-matter description (or "")
 * @property {number} sizeChars
 * @property {number} estTokens
 */

const registry = new Map(); // id → { text, meta }

function parseFrontmatter(text) {
  // Minimal front-matter parse: leading "---\n…\n---\n" block.
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { description: "" };
  let description = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^description:\s*(.*)$/);
    if (kv) description = kv[1].trim();
  }
  return { description };
}

function loadRegistry() {
  if (process.env["9ROUTER_STRIX_DISABLE"]) return;
  for (const group of STRIX_GROUPS) {
    const groupDir = join(BASE_DIR, "strix-payloads", group.dir);
    if (!existsSync(groupDir)) continue;
    let files = [];
    try {
      files = readdirSync(groupDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const id = `strix:${group.cat}:${name}`;
      try {
        const text = readFileSync(join(groupDir, file), "utf8").trim();
        if (!text) continue;
        const { description } = parseFrontmatter(text);
        registry.set(id, {
          text,
          meta: {
            id,
            cat: group.cat,
            name,
            description,
            sizeChars: text.length,
            estTokens: Math.max(1, Math.round(text.length / 4)),
          },
        });
      } catch {
        // fail-open: skip unreadable file
      }
    }
  }
}

loadRegistry();

/** All registered Strix payload rows (metadata only, no text). */
export function getStrixPayloads() {
  return [...registry.values()].map((r) => r.meta);
}

/** Resolve one payload id to its full text + metadata. */
export function getStrixPayload(id) {
  const entry = registry.get(id);
  return entry ? { text: entry.text, ...entry.meta } : null;
}

/** Flat list of registered ids. */
export function getStrixIds() {
  return [...registry.keys()];
}
