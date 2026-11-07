import { describe, it, expect } from "vitest";

// ─── godmodePayloads: explicit level → text resolution ───
// There is no per-model auto-selection any more: getGodmodePrompt() returns
// exactly the variant it is given (or the classic fallback for an unknown id).
import {
  getGodmodePrompt,
  VARIANT_ADAPTIVE_THINKING,
} from "../../open-sse/payload/godmodePayloads.js";

describe("getGodmodePrompt level resolution", () => {
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

  // Regression: EXTERNAL_VARIANTS is a module-load snapshot, so an f:* payload
  // imported after process start (custom-payloads CRUD) must still resolve via
  // the live registry instead of silently falling back to the classic text.
  it("resolves freshly-registered f:* ids from the live registry", async () => {
    const { getExternalPayload, refreshCustomPayloadRegistry, getCustomDir } =
      await import("../../open-sse/payload/jailbreakPayloads.js");
    const { writeFileSync, rmSync, existsSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const id = "f:custom:regression-live-lookup";
    const abs = join(getCustomDir(), "regression-live-lookup.md");
    mkdirSync(getCustomDir(), { recursive: true });
    writeFileSync(abs, "LIVE REGRESSION MARKER");
    refreshCustomPayloadRegistry();
    try {
      expect(getExternalPayload(id)).toBe("LIVE REGRESSION MARKER");
      expect(getGodmodePrompt(id)).toBe("LIVE REGRESSION MARKER");
    } finally {
      if (existsSync(abs)) rmSync(abs);
      refreshCustomPayloadRegistry();
    }
  });
});
