import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #4311: POST /api/providers was O(pool) per insert. Inside one transaction it
// read the whole pool AND renumbered every row's priority, so a 5k-key import
// was O(n*m) — ~25M statements at a 5k pool — and every parallel writer
// serialized on the same transaction. On top of that, an apikey name collision
// silently overwrote the stored key with no 409.
//
// The test DB persists across tests in a file, so each case uses its own
// provider alias; priorities are per-provider.
//
// DB isolation: the whole chain index.js → driver.js → paths.js → dataDir.js
// resolves DATA_DIR at module-load time, so a top-level static import would
// point at the live ~/.9router data and leak "seed-N" test connections into
// the app's real database (which is exactly what polluted /dashboard/combos).
// Point DATA_DIR at a throwaway dir, reset the module registry, then import
// the module dynamically — same pattern as db-driver-chain.test.js.

let db; // the re-imported db module, initialized in beforeAll
let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-insert-cost-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter; // force getAdapter() to re-resolve DATA_FILE
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
});

afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function seed(provider, n) {
  for (let i = 0; i < n; i++) {
    await db.createProviderConnection({
      provider,
      authType: "apikey",
      name: `seed-${i}`,
      apiKey: `k${i}`,
    });
  }
}

describe("provider insert is O(1) in pool size (#4311)", () => {
  it("assigns sequential priorities without a renumber pass", async () => {
    const P = `openai-compatible-seq-${Date.now()}`;
    await seed(P, 3);
    const list = await db.getProviderConnections({ provider: P });
    expect(list.map((c) => c.name)).toEqual(["seed-0", "seed-1", "seed-2"]);
    expect(list.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("keeps a large pool in insertion order", async () => {
    const P = `openai-compatible-ord-${Date.now()}`;
    await seed(P, 60);
    const list = await db.getProviderConnections({ provider: P });
    expect(list).toHaveLength(60);
    // The bug showed up as reordering once the pool grew past a few rows.
    expect(list[0].name).toBe("seed-0");
    expect(list[59].name).toBe("seed-59");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].priority).toBeGreaterThan(list[i - 1].priority);
    }
  });

  it("still renumbers on delete, so gaps do not accumulate", async () => {
    const P = `openai-compatible-del-${Date.now()}`;
    await seed(P, 4);
    const before = await db.getProviderConnections({ provider: P });
    await db.deleteProviderConnection(before[0].id);
    const after = await db.getProviderConnections({ provider: P });
    expect(after.map((c) => c.priority)).toEqual([1, 2, 3]);
  });

  it("still renumbers on an explicit priority update", async () => {
    // Unique alias per run: the DB persists across runs, so a fixed alias
    // would accumulate rows and make this assertion depend on test order.
    const P = `openai-compatible-upd-${Date.now()}`;
    await seed(P, 4);
    await new Promise((r) => setTimeout(r, 10));
    const list = await db.getProviderConnections({ provider: P });
    // Move the last one to the front.
    await db.updateProviderConnection(list[3].id, { priority: 1 });
    const after = await db.getProviderConnections({ provider: P });
    expect(after[0].name).toBe("seed-3");
  });
});

describe("name collision no longer destroys a key silently (#4311)", () => {
  // Seeded once (at the describe level, not per-test): these cases each
  // mutate the SAME row, so a per-test seed would make the later assertions
  // depend on earlier ones.
  let P;
  let original;

  beforeAll(async () => {
    P = `openai-compatible-clash-${Date.now()}`;
    await seed(P, 1);
    original = (await db.getProviderConnections({ provider: P }))[0];
  });

  it("throws a typed conflict instead of overwriting, when overwrite is refused", async () => {
    await expect(
      db.createProviderConnection({
        provider: P,
        authType: "apikey",
        name: original.name,
        apiKey: "REPLACEMENT-KEY",
        allowOverwrite: false,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_NAME_CONFLICT", existingId: original.id });

    // The stored key must be untouched.
    const after = (await db.getProviderConnections({ provider: P }))[0];
    expect(after.apiKey).toBe(original.apiKey);
  });

  it("still overwrites when the caller opts in", async () => {
    const updated = await db.createProviderConnection({
      provider: P,
      authType: "apikey",
      name: original.name,
      apiKey: "REPLACEMENT-KEY",
      allowOverwrite: true,
    });
    expect(updated.id).toBe(original.id);
    const after = (await db.getProviderConnections({ provider: P }))[0];
    expect(after.apiKey).toBe("REPLACEMENT-KEY");
  });

  it("defaults to the previous overwrite behaviour for existing callers", async () => {
    // Every other call site in the repo (oauth routes, bulk import) omits the
    // flag, so they must keep working exactly as before.
    const updated = await db.createProviderConnection({
      provider: P,
      authType: "apikey",
      name: original.name,
      apiKey: "LEGACY-PATH-KEY",
    });
    expect(updated.id).toBe(original.id);
  });

  it("does not collide across different providers", async () => {
    const other = await db.createProviderConnection({
      provider: "openai-compatible-other",
      authType: "apikey",
      name: original.name,
      apiKey: "other-key",
    });
    expect(other.id).not.toBe(original.id);
  });
});
