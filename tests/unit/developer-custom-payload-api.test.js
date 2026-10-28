// CRUD API behind /dashboard/custom-payloads (src/app/api/developer/custom-payload/route.js).
// Uses a real fs-backed custom dir in a temp folder and a simulated codeload
// tarball (mocked execSync) so the repo-import branch is exercised offline.
import { readdirSync, readFileSync, rmSync, mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const payloadAuth = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/auth/payloadAuth", () => ({
  assertPayloadAuth: async () => payloadAuth.ok,
}));

// Minimal stand-in for open-sse/payload/jailbreakPayloads.js custom-dir helpers.
// Production ids are `f:custom:<slug-without-extension>` (flat dir).
const lib = vi.hoisted(() => ({ dir: "" }));
vi.mock("open-sse/payload/jailbreakPayloads.js", async () => {
  const fs = await import("node:fs");
  const pathMod = await import("node:path");
  // nested dir umum (meniru walkAutoscan + slugify produksi: id = slug path relatif)
  const walk = (d, rel = []) => {
    const out = [];
    if (!fs.existsSync(d)) return out;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const sub = rel.concat(e.name);
      if (e.isDirectory()) out.push(...walk(pathMod.join(d, e.name), sub));
      else if (/\.(md|txt)$/i.test(e.name)) out.push({ rel: sub.join("/") });
    }
    return out;
  };
  const slug = (p) => p.replace(/\.(md|txt)$/i, "").split("/").join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const rows = () =>
    walk(lib.dir)
      .map(({ rel }) => ({
        abs: pathMod.join(lib.dir, ...rel.split("/")),
        rel,
      }))
      .filter(({ abs }) => fs.readFileSync(abs, "utf8").trim())
      .map(({ abs, rel }) => ({
        id: `f:custom:${slug(rel)}`,
        file: rel,
        chars: fs.readFileSync(abs, "utf8").length,
        updated: fs.statSync(abs).mtimeMs,
      }));
  return {
    getCustomDir: () => lib.dir,
    getCustomPayloads: rows,
    // Production helper menambahkan full text ke row.
    getCustomPayload: (id) => { const r = rows().find((x) => x.id === id); return r && { ...r, text: fs.readFileSync(pathMod.join(lib.dir, ...r.file.split("/")), "utf8") }; },
    deleteCustomPayload: (id) => {
      if (!String(id).startsWith("f:custom:")) return false;
      const row = rows().find((r) => r.id === id);
      if (!row) return false;
      try { fs.unlinkSync(pathMod.join(lib.dir, ...row.file.split("/"))); return true; } catch { return false; }
    },
  };
});

// Fake the repo-import shell pipeline (now just `curl -sL … | tar -xz -C tmp
// --strip-components=1` — the mkdir/cleanup are plain fs calls in production)
// without any network.
vi.mock("node:child_process", async () => {
  const fs = await import("node:fs");
  return {
    execSync: (cmd) => {
      const dir = JSON.parse(cmd.match(/tar -xz -C ("[^"]+")/)[1]);
      fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(dir, "README.md"), "# readme junk");
      fs.writeFileSync(path.join(dir, "LICENSE.txt"), "MIT");
      fs.writeFileSync(path.join(dir, "My Payload!.md"), "custom repo payload");
      fs.writeFileSync(path.join(dir, "sub", "nested.txt"), "nested repo payload");
      // Windows portability cases: reserved dir name, reserved file stem,
      // trailing-dot dir name.
      fs.mkdirSync(path.join(dir, "con"), { recursive: true });
      fs.mkdirSync(path.join(dir, "sub", "sub dir."), { recursive: true });
      fs.writeFileSync(path.join(dir, "con", "aux.txt"), "inside windows-nuke dir");
      fs.writeFileSync(path.join(dir, "nul.txt"), "windows-nuke file");
      fs.writeFileSync(path.join(dir, "sub", "sub dir.", "deep.txt"), "trailing-dot dir");
    },
  };
});

const toReq = (url, init) => new Request(url, init);
const post = (payload, id = "f:custom:x") =>
  toReq(`http://x/api/developer/custom-payload?id=${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
const get = (id = "") => toReq(`http://x/api/developer/custom-payload${id ? `?id=${id}` : ""}`);
const del = (id = "") => toReq(`http://x/api/developer/custom-payload${id ? `?id=${id}` : ""}`, { method: "DELETE" });

let route;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "9r-custom-payload-test-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("raw import text", { status: 200 })));
  route = await import("@/app/api/developer/custom-payload/route.js");
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

beforeEach(() => {
  lib.dir = path.join(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  payloadAuth.ok = true;
});

describe("GET", () => {
  it("401 ketika auth gagal", async () => {
    payloadAuth.ok = false;
    const res = await route.GET(toReq("http://x/"));
    expect(res.status).toBe(401);
  });

  it("list kosong → rows: []", async () => {
    const res = await route.GET(get());
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });

  it("GET ?id= mengembalikan full text; unknown → 404", async () => {
    await route.POST(post({ name: "alpha.md", text: "A" }));
    const full = await (await route.GET(get("f:custom:alpha"))).json();
    expect(full.text).toBe("A");
    expect((await route.GET(get("f:custom:none"))).status).toBe(404);
  });
});

describe("POST — manual save", () => {
  it("menulis file & slugify nama — dan membuat dir yang belum ada (regresi ENOENT)", async () => {
    expect(existsSync(lib.dir)).toBe(false); // dir belum ada
    const res = await route.POST(post({ name: "My Great Prompt!.md", text: "x".repeat(10) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ saved: 1, names: ["my-great-prompt.md"] });
    expect(readFileSync(path.join(lib.dir, "my-great-prompt.md"), "utf8")).toBe("x".repeat(10));
  });

  it("empty text → 400; .txt disimpan jadi .md", async () => {
    expect((await route.POST(post({ name: "a.md", text: "" }))).status).toBe(400);
    const txt = await route.POST(post({ name: "b.txt", text: "hello" }));
    expect((await txt.json()).names).toEqual(["b.md"]);
  });

  it("JSON body invalid → 400", async () => {
    expect((await route.POST(toReq("http://x/", { method: "POST", body: "not json" }))).status).toBe(400);
  });
});

describe("POST — import URL", () => {
  it("host tidak diizinkan → 400", async () => {
    const res = await route.POST(post({ url: "https://evil.example.com/p.md" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/github\.com/);
  });

  it("protocol selain https → 400", async () => {
    expect((await route.POST(post({ url: "http://raw.githubusercontent.com/a/b/c.md" }))).status).toBe(400);
  });

  it("raw file URL → fetch, simpan asal nama file", async () => {
    const res = await route.POST(post({ url: "https://raw.githubusercontent.com/o/r/main/payload.md" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(readFileSync(path.join(lib.dir, body.names[0]), "utf8")).toBe("raw import text");
  });

  it("repo URL → codeload tarball: skip README/LICENSE, preserve subfolder", async () => {
    const res = await route.POST(post({ url: "https://github.com/o/r" }));
    if (res.status !== 200) console.log("import body:", await res.clone().text());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(5);
    expect(body.names.sort()).toEqual([
      "aux-file.txt",                 // segmen `con` dibuang (reserved Windows), stem `aux` → `-file`
      "my-payload.md",
      "nul-file.txt",                 // stem `nul` reserved Windows → akhiran `-file`
      "sub/nested.txt",
      "sub/sub-dir/deep.txt",         // folder `sub dir.` → trailing dot di-strip → `sub-dir`
    ]);
    // struktur folder repo dipertahankan di bawah custom dir (rel path “/” di semua OS)
    expect(readFileSync(path.join(lib.dir, "sub", "nested.txt"), "utf8")).toBe("nested repo payload");
    const list = await (await route.GET(get())).json();
    expect(list.rows.map((r) => r.id).sort().join(",")).toBe(
      "f:custom:aux-file,f:custom:my-payload,f:custom:nul-file,f:custom:sub-nested,f:custom:sub-sub-dir-deep"
    );
    // temp tar dir dibersihkan di finally (dir route = `9r-custom-<timestamp>`, full digit)
    expect(readdirSync(os.tmpdir()).filter((d) => /^9r-custom-\d+$/.test(d))).toEqual([]);
  });
});

describe("DELETE", () => {
  it("hapus existing → ok:true & file lenyap", async () => {
    await route.POST(post({ name: "doomed.md", text: "bye" }));
    const res = await route.DELETE(del("f:custom:doomed"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(existsSync(path.join(lib.dir, "doomed.md"))).toBe(false);
  });

  it("unknown id → 404; tanpa id → 400", async () => {
    expect((await route.DELETE(del("f:custom:none"))).status).toBe(404);
    expect((await route.DELETE(del())).status).toBe(400);
  });
});
