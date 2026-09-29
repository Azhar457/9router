import { describe, it, expect } from "vitest";

// ─── godmodePayloads: pickGodmodeVariant + VARIANT_ID_TO_PAYLOAD ───
import {
  pickGodmodeVariant,
  getGodmodePrompt,
  GODMODE_LEVELS,
  VARIANT_ADAPTIVE_THINKING,
} from "open-sse/rtk/godmodePayloads.js";

describe("pickGodmodeVariant", () => {
  it("returns classic for empty/invalid model", () => {
    expect(pickGodmodeVariant("")).toBe(GODMODE_LEVELS.CLASSIC);
    expect(pickGodmodeVariant(null)).toBe(GODMODE_LEVELS.CLASSIC);
    expect(pickGodmodeVariant(undefined)).toBe(GODMODE_LEVELS.CLASSIC);
  });

  it("picks adaptive for Claude Fable 5.1", () => {
    expect(pickGodmodeVariant("claude-fable-5-1")).toBe("adaptive");
    expect(pickGodmodeVariant("anthropic/claude-fable-5")).toBe("adaptive");
  });

  it("picks adaptive for Claude Opus 5", () => {
    expect(pickGodmodeVariant("claude-opus-5")).toBe("adaptive");
    expect(pickGodmodeVariant("cc/claude-opus-5")).toBe("adaptive");
  });

  it("picks file-based Bladwin for GPT-6 / GPT-5.6 family", () => {
    expect(pickGodmodeVariant("gpt-6-astra")).toBe("f:ai:gpt-5.6-bladwin");
    expect(pickGodmodeVariant("gpt-5.6-sol")).toBe("f:ai:gpt-5.6-bladwin");
  });

  it("picks adaptive for Grok 4.5+", () => {
    expect(pickGodmodeVariant("grok-4.5")).toBe("adaptive");
    expect(pickGodmodeVariant("x-ai/grok-4.6")).toBe("adaptive");
  });

  it("picks file-based NYX for older Grok / x-ai", () => {
    expect(pickGodmodeVariant("grok-4")).toBe("f:ai:grok-nyx");
    expect(pickGodmodeVariant("x-ai/grok-4.2")).toBe("f:ai:grok-nyx");
  });

  it("picks hermesFast for Hermes", () => {
    expect(pickGodmodeVariant("nousresearch/hermes-4-405b")).toBe("hermesFast");
  });

  it("picks geminiReset for Gemini", () => {
    expect(pickGodmodeVariant("google/gemini-3.5-pro")).toBe("geminiReset");
  });

  it("picks claudeInversion for older Claude", () => {
    expect(pickGodmodeVariant("anthropic/claude-sonnet-4")).toBe("claudeInversion");
  });

  it("picks classic as fallback for unknown model", () => {
    expect(pickGodmodeVariant("some-unknown-model")).toBe(GODMODE_LEVELS.CLASSIC);
  });
});

describe("getGodmodePrompt with adaptive level", () => {
  it("returns VARIANT_ADAPTIVE_THINKING for 'adaptive' level", () => {
    expect(getGodmodePrompt("adaptive")).toBe(VARIANT_ADAPTIVE_THINKING);
  });

  it("returns classic payload for 'classic' level", () => {
    const prompt = getGodmodePrompt("classic");
    expect(prompt).toContain("𝔾𝟘𝔻𝕄𝟘𝔻𝟛");
  });

  it("returns custom text for 'custom' level", () => {
    expect(getGodmodePrompt("custom", "my custom payload")).toBe("my custom payload");
  });

  it("falls back to classic for unknown level", () => {
    const prompt = getGodmodePrompt("nonexistent-level");
    expect(prompt).toContain("𝔾𝟘𝔻𝕄𝟘𝔻𝟛");
  });
});
