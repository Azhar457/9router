import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { createProviderNode } = await import("@/models/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    createProviderNode,
    getModelInfo,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("model routing", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps built-in provider aliases ahead of compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible CF Collision",
      prefix: "cf",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("cf/@cf/black-forest-labs/flux-2-klein-9b"))
      .resolves.toEqual({
        provider: "cloudflare-ai",
        model: "@cf/black-forest-labs/flux-2-klein-9b",
      });
  });

  it("still routes non-reserved compatible node prefixes", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await ctx.createProviderNode({
      id: "openai-compatible-chat-test",
      type: "openai-compatible",
      name: "Compatible OCT",
      prefix: "oct",
      apiType: "chat",
      baseUrl: "https://compatible.test/v1",
    });

    await expect(ctx.getModelInfo("oct/gpt-image-1"))
      .resolves.toEqual({
        provider: "openai-compatible-chat-test",
        model: "gpt-image-1",
      });
  });

  it("routes bare OpenRouter vendor ids through the openrouter provider", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // LiteLLM (Strix) strips one `openrouter/` prefix, so clients send
    // `poolside/laguna-xs-2.1:free` — unknown first segment, remaining path
    // has a slash → treat the whole string as an OpenRouter model id.
    await expect(ctx.getModelInfo("poolside/laguna-xs-2.1:free"))
      .resolves.toEqual({
        provider: "openrouter",
        model: "poolside/laguna-xs-2.1:free",
      });
  });

  it("keeps openrouter-prefixed ids unchanged", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await expect(ctx.getModelInfo("openrouter/poolside/laguna-xs-2.1:free"))
      .resolves.toEqual({
        provider: "openrouter",
        model: "poolside/laguna-xs-2.1:free",
      });
  });

  it("routes any unknown-provider id via openrouter", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // Unknown first segment → treat the whole string as an OpenRouter model
    // id (a typo like "opnai/gpt-5" surfaces as an OpenRouter error rather
    // than a confusing "No active credentials for provider: opnai").
    await expect(ctx.getModelInfo("unknownvendor/gpt-5"))
      .resolves.toEqual({
        provider: "openrouter",
        model: "unknownvendor/gpt-5",
      });
  });

  it("does not hijack known provider ids", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await expect(ctx.getModelInfo("ollama/gpt-oss:120b"))
      .resolves.toEqual({
        provider: "ollama",
        model: "gpt-oss:120b",
      });
  });

  it("routes unregistered `:free` ids of a known provider via openrouter", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // `nvidia/...:free` exists on OpenRouter's free tier but not in the direct
    // nvidia provider's static list → route via OpenRouter.
    await expect(ctx.getModelInfo("nvidia/nemotron-3-ultra-550b-a55b:free"))
      .resolves.toEqual({
        provider: "openrouter",
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      });
  });

  it("keeps registered direct-provider ids untouched even with :free suffix", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    await expect(ctx.getModelInfo("nvidia/nemotron-3-ultra-550b-a55b"))
      .resolves.toEqual({
        provider: "nvidia",
        model: "nemotron-3-ultra-550b-a55b",
      });
  });

  it("keeps passthrough provider :free ids on their own provider", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // kilocode has `passthroughModels: true` — its `:free` ids are valid in its
    // own gateway catalog, so they must NOT be hijacked by the openrouter fallback.
    await expect(ctx.getModelInfo("kc/nex-agi/nex-n2.5-pro:free"))
      .resolves.toEqual({
        provider: "kilocode",
        model: "nex-agi/nex-n2.5-pro:free",
      });

    await expect(ctx.getModelInfo("kc/dots-studio/dots-3-note-preview:free"))
      .resolves.toEqual({
        provider: "kilocode",
        model: "dots-studio/dots-3-note-preview:free",
      });
  });
});
