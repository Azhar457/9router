import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock/home") },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

// The sqlite3 CLI fallback must be servable from tests: it is the real
// production path when better-sqlite3 native bindings are unavailable.
// Note: the route's strategy-1 uses CommonJS `require("better-sqlite3")`, which
// cannot resolve under vitest's ESM runner (ReferenceError → silently caught),
// so extraction tests below exercise the CLI strategy instead.
const cliRows = new Map();

vi.mock("child_process", () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (cmd === "which") {
      cb(null, { stdout: "/usr/bin/cursor", stderr: "" });
      return;
    }
    if (cmd === "sqlite3") {
      const sql = String(args[1] || "");
      const key = sql.match(/key='([^']+)'/)?.[1];
      const value = key != null ? cliRows.get(key) : undefined;
      // Real child_process.execFile carries a custom util.promisify that yields
      // { stdout, stderr } — mimic that shape (a bare string would break the
      // route's `const { stdout }` destructuring).
      cb(null, { stdout: value != null ? String(value) : "", stderr: "" });
      return;
    }
    cb(new Error(`${cmd} not available`));
  }),
}));

// Keyed sqlite mock matching the current route: prepare(sql).get(key) -> { value }
const tokenRows = new Map();
const mockDbInstance = {
  prepare: vi.fn(() => ({
    get: vi.fn((key) => (tokenRows.has(key) ? { value: tokenRows.get(key) } : null)),
  })),
  close: vi.fn(),
  __throwOnConstruct: false,
};

// Mock better-sqlite3 as a class so `new Database(...)` works
vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor() {
      if (mockDbInstance.__throwOnConstruct) {
        throw new Error("SQLITE_CANTOPEN: unable to open database file");
      }
      return mockDbInstance;
    }
  },
}));

// We need to dynamically import after mocks are registered
let GET;

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    tokenRows.clear();
    cliRows.clear();
    mockDbInstance.__throwOnConstruct = false;
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found with checked locations when no macOS cursor db paths are accessible", async () => {
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(response.body.error).toContain("Cursor - Insiders");
  });

  it("falls back to the manual paste flow when the db exists but cannot be opened", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    mockDbInstance.__throwOnConstruct = true;

    const response = await GET();

    // better-sqlite3 throws → CLI fallback fails (mocked) → strategy 3 asks the
    // user to paste tokens manually.
    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toContain("state.vscdb");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys (sqlite3 CLI fallback)", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    cliRows.set("cursorAuth/accessToken", "test-token");
    cliRows.set("storage.serviceMachineId", "test-machine-id");

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
  });

  it("unwraps JSON-encoded string values (sqlite3 CLI fallback)", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();
    cliRows.set("cursorAuth/accessToken", '"json-token"');
    cliRows.set("storage.serviceMachineId", '"json-machine-id"');

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  // ── Missing tokens → manual fallback ──────────────────────────────────

  it("returns the manual paste flow when tokens are missing from the db", async () => {
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
  });

  // ── Linux / other platforms ───────────────────────────────────────────

  it("linux probes the default-branch config paths and reports checked locations", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(fsPromises.access).toHaveBeenCalled();
  });

  it("freebsd uses the default (linux-style) candidate paths", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(".config/Cursor");
  });
});
