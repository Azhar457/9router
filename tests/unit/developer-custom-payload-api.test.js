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
  const readCat = (text) => {
    const line = text.split(/\r?\n/, 3).find((l) => /^cat:\s*\w+/i.test(l));
    return line?.toLowerCase().match(/cat:\s*(\w+)/)?.[1] || "general";
  };
  const rows = () =>
    walk(lib.dir)
      .map(({ rel }) => ({
        abs: pathMod.join(lib.dir, ...rel.split("/")),
        rel,
      }))
      .filter(({ abs }) => fs.readFileSync(abs, "utf8").trim())
      .map(({ abs, rel }) => {
        const text = fs.readFileSync(abs, "utf8");
        return {
          id: `f:custom:${slug(rel)}`,
          file: rel,
          chars: text.length,
          updated: fs.statSync(abs).mtimeMs,
          cat: readCat(text),
        };
      });
  const refreshCount = { n: 0 };
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
    // CRUD-nya harus mega-kipas registry agar dropdown fresh tanpa restart.
    refreshCustomPayloadRegistry: vi.fn(() => { refreshCount.n += 1; }),
    refreshCount,
    renameCustomPayload: (id, rawName) => {
      const row = rows().find((r) => r.id === id);
      if (!row) return null;
      const stem = String(rawName || "").replace(/\.(md|txt)?$/i, "").toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|[-.]+$/g, "").slice(0, 72);
      if (!stem || !/[a-z0-9]/.test(stem)) return null;
      const segs = row.file.split("/");
      const ext = (row.file.match(/\.(md|txt)$/i)?.[0] || ".md").toLowerCase();
      segs[segs.length - 1] = `${stem}${ext}`;
      const nextRel = segs.join("/");
      const nextAbs = pathMod.join(lib.dir, ...nextRel.split("/"));
      if (nextAbs === pathMod.join(lib.dir, ...row.file.split("/"))) return row.id;
      if (fs.existsSync(nextAbs)) return null;
      fs.renameSync(pathMod.join(lib.dir, ...row.file.split("/")), nextAbs);
      return `f:custom:${slug(nextRel)}`;
    },
    setCustomPayloadCat: (id, cat) => {
      const row = rows().find((r) => r.id === id);
      if (!row) return null;
      if (!["coding", "pentest", "creative", "general", "nsfw"].includes(cat)) return null;
      const abs = pathMod.join(lib.dir, ...row.file.split("/"));
      const text = fs.readFileSync(abs, "utf8");
      const lines = text.split(/\r?\n/);
      const first = lines.findIndex((l) => /^cat:\s*\w+/.test(l));
      if (first === 0) lines[0] = `cat: ${cat}`;
      const body = lines.join("\n").replace(/^\s*\n+/, "");
      fs.writeFileSync(abs, first === 0 ? body : `cat: ${cat}\n${body}`);
      return cat;
    },
    PAYLOAD_CATEGORIES: {
      coding: { label: "Coding" },
      pentest: { label: "Red-Team" },
      creative: { label: "Creative / RP" },
      general: { label: "General" },
      nsfw: { label: "RP / NSFW" },
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
const delBatch = (ids) => toReq("http://x/api/developer/custom-payload", {
  method: "DELETE",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ids }),
});
const patch = (body) => toReq("http://x/api/developer/custom-payload", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

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

  it("batch {ids} → hapus semua yang match, lapor yang unknown", async () => {
    await route.POST(post({ name: "batch-a.md", text: "a" }));
    await route.POST(post({ name: "batch-b.md", text: "b" }));
    const res = await route.DELETE(delBatch(["f:custom:batch-a", "f:custom:ghost"]));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: false, deleted: 1, missing: ["f:custom:ghost"] });
    expect(existsSync(path.join(lib.dir, "batch-a.md"))).toBe(false);
    expect(existsSync(path.join(lib.dir, "batch-b.md"))).toBe(true);
  });

  it("batch kosong → 400; batch yang valid → deleted hitung", async () => {
    expect((await route.DELETE(delBatch([]))).status).toBe(400);
    await route.POST(post({ name: "batch-c.md", text: "c" }));
    const res = await route.DELETE(delBatch(["f:custom:batch-c"]));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(1);
  });
});

describe("PATCH — rename & kategori", () => {
  it("{name} → file & id ikut berubah; 409 saat tabrakan", async () => {
    await route.POST(post({ name: "old-name.md", text: "payload" }));
    const res = await route.PATCH(patch({ id: "f:custom:old-name", name: "New Name!" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe("f:custom:new-name");
    expect(existsSync(path.join(lib.dir, "old-name.md"))).toBe(false);
    expect(existsSync(path.join(lib.dir, "new-name.md"))).toBe(true);
    // tabrakan dengan payload lain
    await route.POST(post({ name: "taker.md", text: "t" }));
    expect((await route.PATCH(patch({ id: "f:custom:taker", name: "new-name" }))).status).toBe(409);
  });

  it("{cat} → flag baris pertama di file; invalid → 400", async () => {
    await route.POST(post({ name: "catty.md", text: "body text" }));
    const res = await route.PATCH(patch({ id: "f:custom:catty", cat: "pentest" }));
    expect(await res.json()).toMatchObject({ ok: true, cat: "pentest" });
    expect(readFileSync(path.join(lib.dir, "catty.md"), "utf8").split("\n")[0]).toBe("cat: pentest");
    const list = await (await route.GET(get())).json();
    expect(list.rows.find((r) => r.id === "f:custom:catty").cat).toBe("pentest");
    expect((await route.PATCH(patch({ id: "f:custom:catty", cat: "nope" }))).status).toBe(400);
  });

  it("rename & cat sekaligus; unknown id → 404; tanpa field → 400", async () => {
    await route.POST(post({ name: "combo.md", text: "hello" }));
    const res = await route.PATCH(patch({ id: "f:custom:combo", name: "Combo X", cat: "coding" }));
    const body = await res.json();
    expect(body).toMatchObject({ id: "f:custom:combo-x", cat: "coding" });
    expect(readFileSync(path.join(lib.dir, "combo-x.md"), "utf8").split("\n")[0]).toBe("cat: coding");
    expect((await route.PATCH(patch({ id: "f:custom:none", name: "x" }))).status).toBe(404);
    expect((await route.PATCH(patch({ id: "f:custom:combo-x" }))).status).toBe(400);
  });

  it("tiap mutasi memicu refreshCustomPayloadRegistry (dropdown fresh tanpa restart)", async () => {
    await route.POST(post({ name: "rf.md", text: "t" }));
    await route.PATCH(patch({ id: "f:custom:rf", cat: "general" }));
    await route.DELETE(del("f:custom:rf"));
    const jPayloads = await import("open-sse/payload/jailbreakPayloads.js");
    expect(jPayloads.refreshCount.n).toBeGreaterThanOrEqual(3);
  });
});
