import { describe, expect, it } from "vitest";
import { injectPlinian } from "../../open-sse/rtk/plinian.js";
import { getPlinianPrompt, PLINIAN_LEVELS } from "../../open-sse/rtk/plinianPrompts.js";

describe("injectPlinian", () => {
  it("appends the level prompt to an existing system message", () => {
    const body = { messages: [{ role: "system", content: "base" }, { role: "user", content: "hi" }] };
    injectPlinian(body, "openai", "ultra");
    expect(body.messages[0].content).toMatch(/^base/);
    expect(body.messages[0].content).toContain("attack each draft");
  });

  it("creates a system message when none exists", () => {
    const body = { messages: [{ role: "user", content: "x" }] };
    injectPlinian(body, "openai", "lite");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("silently verify your draft");
  });

  it("never throws on malformed bodies (fail-open)", () => {
    expect(() => injectPlinian(null, "openai", "full")).not.toThrow();
    expect(() => injectPlinian({}, "openai", "full")).not.toThrow();
    expect(() => injectPlinian({ messages: "junk" }, "openai", "full")).not.toThrow();
  });

  it("falls back to standard prompt on unknown level", () => {
    expect(getPlinianPrompt("bogus")).toBe(getPlinianPrompt(PLINIAN_LEVELS.STANDARD));
  });

  it("prepends optional identity text before the register prompt", () => {
    const body = { messages: [{ role: "user", content: "who are you" }] };
    injectPlinian(body, "openai", "lite", "You are 9Router.");
    expect(body.messages[0].content).toMatch(/^You are 9Router\./);
    expect(body.messages[0].content).toContain("silently verify your draft");
  });

  it("omits identity separator when identity is blank", () => {
    const body = { messages: [{ role: "user", content: "x" }] };
    injectPlinian(body, "openai", "full", "   ");
    expect(body.messages[0].content.startsWith("\n\n")).toBe(false);
  });
});
