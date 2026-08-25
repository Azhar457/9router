import { describe, expect, it } from "vitest";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { injectPlinian } from "../../open-sse/rtk/plinian.js";

// Proves the full steering stack coexists in ONE system message without any
// layer clobbering another — the regression the audit was worried about.
const freshBody = () => ({
  messages: [{ role: "system", content: "BASE" }, { role: "user", content: "q" }],
});

describe("steering stack (caveman + ponytail + plinian)", () => {
  it("keeps every layer when all three fire on the same request", () => {
    const body = freshBody();
    injectCaveman(body, "openai", "lite");
    injectPonytail(body, "openai", "full");
    injectPlinian(body, "openai", "ultra", "You are 9Router.");

    const sys = body.messages[0].content;
    expect(sys.startsWith("BASE")).toBe(true);
    expect(sys).toContain("Auto-Clarity"); // caveman lite marker
    expect(sys).toContain("lazy senior developer"); // ponytail full marker
    expect(sys).toContain("You are 9Router."); // plinian identity
    expect(sys).toContain("attack each draft"); // plinian ultra marker
    // single system message — layers append, never fork into new messages
    expect(body.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("appends deterministically in caveman → ponytail → plinian order", () => {
    const body = freshBody();
    injectCaveman(body, "openai", "lite");
    const afterCaveman = body.messages[0].content;
    injectPonytail(body, "openai", "full");
    const afterPonytail = body.messages[0].content;
    injectPlinian(body, "openai", "standard");

    expect(afterPonytail.startsWith(afterCaveman)).toBe(true);
    expect(body.messages[0].content.indexOf("lazy senior developer"))
      .toBeGreaterThan(afterCaveman.indexOf("Auto-Clarity"));
    expect(body.messages[0].content.lastIndexOf("draft two candidate"))
      .toBeGreaterThan(body.messages[0].content.indexOf("lazy senior developer"));
  });
});
