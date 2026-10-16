import { describe, it, expect, vi, beforeEach } from "vitest";

// ── deriveBaseUrl helper ──────────────────────────────────────────────────────
import { deriveBaseUrl } from "@/shared/utils/deriveBaseUrl.js";

describe("deriveBaseUrl", () => {
  it("strips /images/generations suffix (Agnes image)", () => {
    expect(deriveBaseUrl("https://apihub.agnes-ai.com/v1/images/generations")).toBe(
      "https://apihub.agnes-ai.com/v1"
    );
  });

  it("strips /videos suffix (Agnes video)", () => {
    expect(deriveBaseUrl("https://apihub.agnes-ai.com/v1/videos")).toBe(
      "https://apihub.agnes-ai.com/v1"
    );
  });

  it("leaves a plain base URL unchanged", () => {
    expect(deriveBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });

  it("handles host:port with /images/generations", () => {
    expect(deriveBaseUrl("https://host:8080/images/generations")).toBe("https://host:8080");
  });

  it("strips trailing slash after suffix removal", () => {
    expect(deriveBaseUrl("https://api.openai.com/v1/images/generations/")).toBe(
      "https://api.openai.com/v1"
    );
  });

  it("returns empty string for empty input", () => {
    expect(deriveBaseUrl("")).toBe("");
  });

  it("returns empty string for null/undefined", () => {
    expect(deriveBaseUrl(null)).toBe("");
    expect(deriveBaseUrl(undefined)).toBe("");
  });
});

// ── import-config route handler ───────────────────────────────────────────────
// Mock the @/models layer (which re-exports from @/lib/localDb) so we can
// assert serviceKinds merge and baseUrl overwrite without a real DB.

const mockGetProviderNodeById = vi.fn();
const mockUpdateProviderNode = vi.fn();
const mockGetProviderConnections = vi.fn();
const mockUpdateProviderConnection = vi.fn();

vi.mock("@/models", () => ({
  getProviderNodeById: (...args) => mockGetProviderNodeById(...args),
  updateProviderNode: (...args) => mockUpdateProviderNode(...args),
  getProviderConnections: (...args) => mockGetProviderConnections(...args),
  updateProviderConnection: (...args) => mockUpdateProviderConnection(...args),
}));

vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {
    agnes: {
      id: "agnes",
      display: { name: "Agnes AI" },
      serviceKinds: ["llm", "image", "video"],
      imageConfig: { baseUrl: "https://apihub.agnes-ai.com/v1/images/generations" },
      videoConfig: { baseUrl: "https://apihub.agnes-ai.com/v1/videos" },
    },
    openai: {
      id: "openai",
      display: { name: "OpenAI" },
      serviceKinds: ["llm", "image"],
      imageConfig: { baseUrl: "https://api.openai.com/v1/images/generations" },
    },
  },
}));

const { POST } = await import("@/app/api/provider-nodes/[id]/import-config/route.js");

function makeReq(from) {
  return { json: async () => ({ from }) };
}
function makeParams(id) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/provider-nodes/[id]/import-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges serviceKinds without duplicating existing entries", async () => {
    const node = {
      id: "openai-compatible-test",
      type: "openai-compatible",
      name: "Test",
      prefix: "test",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      serviceKinds: ["image"],
    };
    mockGetProviderNodeById.mockResolvedValue(node);
    mockUpdateProviderNode.mockImplementation(async (_id, updates) => ({ ...node, ...updates }));
    mockGetProviderConnections.mockResolvedValue([]);

    const res = await POST(makeReq("agnes"), makeParams("openai-compatible-test"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    // "image" was already present; "video" is new; no duplicate "image"
    expect(body.serviceKinds).toEqual(expect.arrayContaining(["image", "video"]));
    expect(body.serviceKinds.filter((k) => k === "image")).toHaveLength(1);
  });

  it("overwrites baseUrl when the node has the default OpenAI URL", async () => {
    const node = {
      id: "openai-compatible-test",
      type: "openai-compatible",
      name: "Test",
      prefix: "test",
      baseUrl: "https://api.openai.com/v1",
      serviceKinds: [],
    };
    mockGetProviderNodeById.mockResolvedValue(node);
    mockUpdateProviderNode.mockImplementation(async (_id, updates) => ({ ...node, ...updates }));
    mockGetProviderConnections.mockResolvedValue([{ id: "conn-1", providerSpecificData: {} }]);

    const res = await POST(makeReq("agnes"), makeParams("openai-compatible-test"));
    const body = await res.json();

    expect(body.baseUrl).toBe("https://apihub.agnes-ai.com/v1");
    expect(body.baseUrlsUpdated).toBe(true);
    expect(mockUpdateProviderNode).toHaveBeenCalledWith("openai-compatible-test", expect.objectContaining({
      baseUrl: "https://apihub.agnes-ai.com/v1",
    }));
    // Connection should also be updated with the new base URL
    expect(mockUpdateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({
        providerSpecificData: expect.objectContaining({ baseUrl: "https://apihub.agnes-ai.com/v1" }),
      })
    );
  });

  it("preserves a non-default existing baseUrl", async () => {
    const node = {
      id: "openai-compatible-test",
      type: "openai-compatible",
      name: "Test",
      prefix: "test",
      baseUrl: "https://my-custom-host.example.com/v1",
      serviceKinds: ["image"],
    };
    mockGetProviderNodeById.mockResolvedValue(node);
    mockUpdateProviderNode.mockImplementation(async (_id, updates) => ({ ...node, ...updates }));
    mockGetProviderConnections.mockResolvedValue([]);

    const res = await POST(makeReq("agnes"), makeParams("openai-compatible-test"));
    const body = await res.json();

    expect(body.baseUrl).toBe("https://my-custom-host.example.com/v1");
    expect(body.baseUrlsUpdated).toBe(false);
  });

  it("returns 404 for an unknown built-in provider", async () => {
    const res = await POST(makeReq("does-not-exist"), makeParams("openai-compatible-test"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the node does not exist", async () => {
    mockGetProviderNodeById.mockResolvedValue(null);
    const res = await POST(makeReq("agnes"), makeParams("nonexistent-node"));
    expect(res.status).toBe(404);
  });
});
