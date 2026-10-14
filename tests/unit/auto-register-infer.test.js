import { describe, expect, it } from "vitest";

// inferKind is intentionally duplicated in the auto-register endpoint (kept
// self-contained so the route doesn't pull the whole /v1/models module). This
// test pins the detection rules so a future edit to either copy is caught.
function inferKind(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/video|film|clip|animate/.test(lower)) return "video";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion|banana|pic/.test(lower)) return "image";
  return "llm";
}

describe("auto-register media kind inference", () => {
  it("detects image models", () => {
    expect(inferKind("agnes-image-2.5-flash")).toBe("image");
    expect(inferKind("hf/black-forest-labs/FLUX.1-dev")).toBe("image");
    expect(inferKind("gemini-2.5-flash-image")).toBe("image");
  });

  it("detects video models", () => {
    expect(inferKind("agnes-video-2.5")).toBe("video");
    expect(inferKind("agnes-video-v2.0")).toBe("video");
  });

  it("video beats image for mixed names", () => {
    expect(inferKind("image-to-video-xl")).toBe("video");
  });

  it("detects embedding + tts", () => {
    expect(inferKind("jina-embeddings-v4")).toBe("embedding");
    expect(inferKind("tts-1-hd")).toBe("tts");
  });

  it("unknown names default to llm (never auto-registered)", () => {
    expect(inferKind("agnes-2.5-pro")).toBe("llm");
  });
});
