// /api/developer/custom-payload — user-managed custom payloads.
//
// GET               → list all custom payloads (id, file, chars, cat, updated)
// GET ?id=f:custom:x → full text
// POST {name, text}  → save one .md/.txt file (name ≤80 chars sanitized)
// POST {url}         → import from GitHub: raw .md file or a whole public
//                      repo (codeload tarball, .md/.txt only, README/LICENSE
//                      skipped, ≤512 KB/file, ≤200 files)
// PATCH {id, name?}  → rename file (id = filename slug, so id changes)
// PATCH {id, cat?}   → set category (coding|pentest|creative|general|nsfw;
//                      default general — first-line `cat:` flag)
// DELETE ?id=        → delete by id
// DELETE {ids:[..]}  → batch delete (dashboard checkbox multi-select)
import { mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertPayloadAuth,
} from "@/lib/auth/payloadAuth";
import {
  getCustomDir, getCustomPayload, getCustomPayloads, deleteCustomPayload,
  refreshCustomPayloadRegistry, renameCustomPayload, setCustomPayloadCat,
  PAYLOAD_CATEGORIES,
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
        // Filesystem ops via Node (portable); only the download+untar runs in a
        // shell — `curl | tar` works in cmd.exe (Win10+ ships curl.exe + tar.exe
        // in System32) and on macOS/Linux sh. JSON.stringify provides safe
        // quoting for both (backslashes need no escaping inside cmd.exe quotes).
        mkdirSync(tmp, { recursive: true });
        execSync(`curl -sL ${JSON.stringify(`https://codeload.github.com${u.pathname}/tar.gz/refs/heads/main`)} | tar -xz -C ${JSON.stringify(tmp)} --strip-components=1`, { stdio: "pipe" });
        const walk = (d, base = "") => {
          const out = [];
          for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) out.push(...walk(join(d, e.name), base + e.name + "/"));
            else if (/\.md$|\.txt$/i.test(e.name) && !/^readme|license|^.#$/i.test(e.name)) out.push({ base, name: e.name });
          }
          return out;
        };
        const files = walk(tmp);
        const totalFiles = files.length;
        const kept = files.slice(0, MAX_FILES);
        if (!kept.length) {
          return Response.json({ error: "No .md/.txt payloads found in that repo" }, { status: 400 });
        }
        const saved = [];
        let skipped = 0;
        for (const f of kept) {
          const text = readFileSync(join(tmp, f.base, f.name), "utf8");
          if (!text.trim() || Buffer.byteLength(text) > MAX_FILE) { skipped++; continue; }
          const target = repoFileTarget(dir, f.base, f.name);
          if (!target) { skipped++; continue; }
          writeFileSync(target.abs, text);
          saved.push(target.rel);
        }
        if (saved.length) refreshCustomPayloadRegistry();
        const response = { saved: saved.length, names: saved };
        if (totalFiles > MAX_FILES) response.truncated = true;
        response.note = totalFiles > MAX_FILES
          ? `Imported ${saved.length} of ${totalFiles} files (limit ${MAX_FILES} reached)`
          : (skipped ? `Imported ${saved.length}, skipped ${skipped} (empty or too large)` : undefined);
        return Response.json(response);
      } catch (e) {
        return Response.json({ error: `Import failed: ${String(e.message).slice(0, 120)}` }, { status: 400 });
      } finally {
        try { rmSync(tmp, { recursive: true, force: true }); } catch {}
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
      refreshCustomPayloadRegistry();
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
  refreshCustomPayloadRegistry();
  return Response.json({ saved: 1, names: [name] });
}

// PATCH {id, name?}  → rename the file (id IS the filename slug, so the
//                       dropdown/source id changes with it)
// PATCH {id, cat?}   → set loader category (coding|pentest|creative|general|
//                       nsfw), default general when never set
// 409 when a renamed id collides with an existing payload.
export async function PATCH(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = String(body?.id || "");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  if (getCustomPayloads().every((r) => r.id !== id)) {
    return Response.json({ error: `Unknown payload: ${id}` }, { status: 404 });
  }

  const out = {};
  if (typeof body.name === "string" && body.name.trim()) {
    const nextId = renameCustomPayload(id, body.name);
    if (!nextId) {
      return Response.json({ error: `Rename failed: name unusable or already taken` }, { status: 409 });
    }
    out.id = nextId;
  }
  if (typeof body.cat === "string" && body.cat.trim()) {
    const cat = setCustomPayloadCat(body.name && out.id ? out.id : id, body.cat);
    if (!cat) {
      return Response.json(
        { error: `cat must be one of: ${Object.keys(PAYLOAD_CATEGORIES).join(" | ")}` },
        { status: 400 },
      );
    }
    out.cat = cat;
  }
  if (!out.id && !out.cat) {
    return Response.json({ error: "nothing to update — provide name and/or cat" }, { status: 400 });
  }
  refreshCustomPayloadRegistry();
  const row = getCustomPayload(out.id || id);
  return Response.json({ ok: true, ...out, chars: row?.chars, file: row?.file });
}

export async function DELETE(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Batch form: DELETE body {ids:[…]} — dashboard checkbox multi-select.
  if (request.headers.get("content-type")?.includes("application/json")) {
    let body;
    try { body = await request.json(); } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const idsList = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!idsList.length) return Response.json({ error: "ids array is required" }, { status: 400 });
    const deleted = [];
    const missing = [];
    for (const one of idsList) {
      (deleteCustomPayload(one) ? deleted : missing).push(one);
    }
    if (deleted.length) refreshCustomPayloadRegistry();
    return Response.json(
      { ok: missing.length === 0, deleted: deleted.length, missing },
      { status: deleted.length ? 200 : 404 },
    );
  }
  // Single form kept for backward compatibility (CLI / scripts).
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  const ok = deleteCustomPayload(id);
  if (ok) refreshCustomPayloadRegistry();
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}

// "My Great Prompt!.md" → "my-great-prompt.md"; reject everything else.
function sanitizeName(raw) {
  const base = raw.replace(/\.(md|txt)?$/i, "").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  if (!base || !/[a-z0-9]/i.test(base)) return null;
  return `${base}.md`;
}

// Repo import preserves the repo's own folder structure:
//   AI-Jailbreaks/Deepseek/deepseek.txt → <dir>/ai-jailbreaks/deepseek/deepseek.txt
// The loader (walkAutoscan) already walks recursive dirs and slugs the whole
// relative path into the payload id, so nested files get ids like
// `f:custom:ai-jailbreaks-deepseek-deepseek`. Max 4 dir levels, each ≤48 chars.
// Returns { rel, abs } — rel is always platform-neutral ("/" separators) so it
// matches walkAutoscan's id scheme on every OS (path.relative would emit "\\"
// on Windows).
function repoFileTarget(dir, base, name) {
  const segs = base.replace(/\/+$/, "")
    .split("/").map(sanitizeSeg).filter(Boolean).slice(0, 4);
  if (base.replace(/\/+$/, "").split("/").length > 4) return null;
  let stem = cleanSeg(name.replace(/\.(md|txt)$/i, ""));
  if (!stem || !/[a-z0-9]/i.test(stem)) return null;
  if (WIN_RESERVED.test(stem)) stem = `${stem}-file`;
  const ext = (name.match(/\.(md|txt)$/i)?.[0] || ".md").toLowerCase();
  const rel = [...segs, `${stem}${ext}`].join("/");
  if (!rel) return null;
  mkdirSync(join(dir, ...segs), { recursive: true });
  return { rel, abs: join(dir, ...rel.split("/")) };
}

// Windows-reserved filenames — `con`, `nul`, `com1`, … make mkdir/write fail
// on Windows (case-insensitive, digit suffixes included). Folder segments that
// match are dropped; file stems get a "-file" suffix.
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]\d*|lpt[1-9]\d*)$/i;

function cleanSeg(raw) {
  if (raw === "..") return "";
  return raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|[-.]+$/g, "").slice(0, 48);
}

// Folder segment cleaner: lowercase, safe chars only, no traversal, and no
// Windows-nuke names ("con", "nul", trailing dots — mkdir/write fail on Windows).
function sanitizeSeg(raw) {
  const seg = cleanSeg(raw);
  return WIN_RESERVED.test(seg) || !seg ? "" : seg;
}
