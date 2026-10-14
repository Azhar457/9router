import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// Atria Dawn is a research preview whose reasoning prefill under payload-size
// prompts (8–70KB jailbreak/steering injects) regularly exceeds the 360s global
// STREAM_STALL_TIMEOUT_MS and false-fires the watchdog. The per-provider
// override must survive the registry → config PROVIDERS barrel, or the 360s
// default re-arms and the A/B "test" arm false-stalls again.
describe("provider stall timeout overrides", () => {
  it("atria carries a stallTimeoutMs override > 360s", () => {
    const stall = PROVIDERS["atria"]?.stallTimeoutMs;
    expect(stall).toBe(600000);
  });

  it("providers without the override stay undefined (default re-arms)", () => {
    expect(PROVIDERS["qoder"]?.stallTimeoutMs).toBe(120000);
    expect(PROVIDERS["dahl"]?.stallTimeoutMs).toBeUndefined();
  });
});
