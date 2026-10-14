import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "../../src/app/api/provider-nodes/[id]/auto-register/route.js";

// Mock localDb and pingModelByKind
vi.mock("@/lib/localDb", () => ({
  getProviderNodeById: vi.fn(),
  getProviderConnections: vi.fn(),
  getCustomModels: vi.fn(),
  addCustomModel: vi.fn(),
  updateProviderNode: vi.fn(),
}));

vi.mock("@/app/api/models/test/ping", () => ({
  pingModelByKind: vi.fn(),
}));

import { getProviderNodeById, getProviderConnections, getCustomModels, addCustomModel, updateProviderNode } from "@/lib/localDb";
import { pingModelByKind } from "@/app/api/models/test/ping";

describe("POST /api/provider-nodes/[id]/auto-register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 if node is not found", async () => {
    getProviderNodeById.mockResolvedValue(null);
    const req = new Request("http://localhost/api/provider-nodes/node-1/auto-register", {
      method: "POST",
      body: JSON.stringify({ test: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "node-1" }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Provider node not found");
  });

  it("scans, tests, and registers media models successfully", async () => {
    getProviderNodeById.mockResolvedValue({
      id: "node-1",
      type: "openai-compatible",
      prefix: "custom-node",
      serviceKinds: ["llm"],
    });

    getProviderConnections.mockResolvedValue([
      { isActive: true, apiKey: "secret-key", providerSpecificData: { baseUrl: "https://api.example.com/v1" } }
    ]);

    getCustomModels.mockResolvedValue([]);

    // Mock global fetch for upstream /models
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "text-model-1", name: "Text Model" },
          { id: "agnes-image-v1", name: "Image Model" },
          { id: "tts-1", name: "TTS Model" }
        ]
      })
    });

    // Mock ping success for image, failure for tts
    pingModelByKind.mockImplementation(async (model) => {
      if (model.includes("image")) return { ok: true, latencyMs: 120 };
      return { ok: false, error: "timeout" };
    });

    addCustomModel.mockResolvedValue({});
    updateProviderNode.mockResolvedValue({});

    const req = new Request("http://localhost/api/provider-nodes/node-1/auto-register", {
      method: "POST",
      body: JSON.stringify({ test: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "node-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.scanned).toBe(2); // image and tts (text-model is llm, not media)
    expect(data.registered).toBe(1); // only image passed ping

    // Verify addCustomModel was called for image
    expect(addCustomModel).toHaveBeenCalledWith(expect.objectContaining({
      providerAlias: "custom-node",
      id: "agnes-image-v1",
      type: "image",
    }));

    global.fetch = originalFetch;
  });
});
