// /api/developer/custom-payload — user-managed custom payloads.
//
// GET               → list all custom payloads (id, file, chars, updated)
// GET ?id=f:custom:x → full text
// POST {name, text}  → save one .md/.txt file (name ≤80 chars sanitized)
// POST {url}         → import from GitHub: raw .md file or a whole public
//                      repo (codeload tarball, .md/.txt only, README/LICENSE
//                      skipped, ≤512 KB/file, ≤200 files)
// DELETE ?id=        → delete by id
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertPayloadAuth,
} from "@/lib/auth/payloadAuth";
import {
  getCustomDir, getCustomPayload, getCustomPayloads, deleteCustomPayload,
} from "open-sse/payload/jailbreakPayloads.js";

export const dynamic = "force-dynamic";

const MAX_FILE = 512 * 1024;
const MAX_FILES = 200;
const ALLOWED_HOSTS = new Set([
  "github.com", "raw.githubusercontent.com", "codeload.github.com", "gist.githubusercontent.com",
]);

function ids() { return getCustomPayloads(); }

export async function GET(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const row = getCustomPayload(id);
    if (!row) return Response.json({ error: `Unknown payload: ${id}` }, { status: 404 });
    return Response.json(row);
  }
  return Response.json({ rows: ids() });
}

export async function POST(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dir = getCustomDir();
  mkdirSync(dir, { recursive: true });

  // Single file import from a GitHub raw/plain URL.
  if (body?.url && !body?.text) {
    let u;
    try { u = new URL(String(body.url)); } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
      return Response.json({ error: "Only github.com / raw.githubusercontent.com / codeload.github.com / gist URLs are allowed" }, { status: 400 });
    }
    // repo URL → walk the codeload tarball; single raw .md/.txt → direct fetch
    const isRepo = /github\.com$/.test(u.hostname) && !/\/(raw|gist)/.test(u.pathname);
    if (isRepo) {
      const tmp = join(tmpdir(), `9r-custom-${Date.now()}`);
      try {
        execSync(`rm -rf ${JSON.stringify(tmp)} && mkdir -p ${JSON.stringify(tmp)}`, { stdio: "pipe" });
        execSync(`curl -sL ${JSON.stringify(`https://codeload.github.com${u.pathname}/tar.gz/refs/heads/main`)} | tar -xz -C ${JSON.stringify(tmp)} --strip-components=1`, { stdio: "pipe" });
        const walk = (d, base = "") => {
          const out = [];
          for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) out.push(...walk(join(d, e.name), base + e.name + "/"));
            else if (/\.md$|\.txt$/i.test(e.name) && !/^readme|license|^.#$/i.test(e.name)) out.push({ base, name: e.name });
          }
          return out;
        };
        const files = walk(tmp).slice(0, MAX_FILES);
        if (!files.length) {
          return Response.json({ error: "No .md/.txt payloads found in that repo" }, { status: 400 });
        }
        const saved = [];
        for (const f of files) {
          const text = readFileSync(join(tmp, f.base, f.name), "utf8");
          if (!text.trim() || Buffer.byteLength(text) > MAX_FILE) continue;
          const safe = sanitizeName(`${f.base}${f.name}`.slice(-60));
          if (!safe) continue;
          writeFileSync(join(dir, safe), text);
          saved.push(safe);
        }
        return Response.json({ saved: saved.length, names: saved });
      } catch (e) {
        return Response.json({ error: `Import failed: ${String(e.message).slice(0, 120)}` }, { status: 400 });
      } finally {
        try { execSync(`rm -rf ${JSON.stringify(tmp)}`, { stdio: "pipe" }); } catch {}
      }
    }
    // single-file URL
    try {
      const res = await fetch(u);
      if (!res.ok) return Response.json({ error: `fetch: ${res.status}` }, { status: 400 });
      const text = await res.text();
      if (!text.trim() || Buffer.byteLength(text) > MAX_FILE) {
        return Response.json({ error: "Empty or too large (>512 KB)" }, { status: 400 });
      }
      const name = sanitizeName(decodeURIComponent(u.pathname.split("/").pop()) || `import-${Date.now()}.md`);
      writeFileSync(join(dir, name), text);
      return Response.json({ saved: 1, names: [name] });
    } catch (e) {
      return Response.json({ error: `fetch failed: ${e.message}` }, { status: 400 });
    }
  }

  // Manual save {name, text}
  const name = sanitizeName(String(body?.name || ""));
  const text = typeof body?.text === "string" ? body.text : "";
  if (!name) return Response.json({ error: "name must be a .md or .txt file name" }, { status: 400 });
  if (!text.trim()) return Response.json({ error: "text cannot be empty" }, { status: 400 });
  if (Buffer.byteLength(text) > MAX_FILE) return Response.json({ error: "too large (>512 KB)" }, { status: 400 });
  writeFileSync(join(dir, name), text);
  return Response.json({ saved: 1, names: [name] });
}

export async function DELETE(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const ok = deleteCustomPayload(id);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}

// "My Great Prompt!.md" → "my-great-prompt.md"; reject everything else.
function sanitizeName(raw) {
  const base = raw.replace(/\.(md|txt)?$/i, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  if (!base || !/[a-z0-9]/i.test(base)) return null;
  return `${base}.md`;
}
