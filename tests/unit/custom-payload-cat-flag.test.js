// The first-line `cat: <key>` flag is loader metadata, not payload text.
// It used to ride along inside the payload editor and inside the prompt sent
// to the model (`cat: general` showing up above the actual jailbreak text).
// These cases pin the read-side stripping against the real module — no mocks.
import { describe, it, expect } from "vitest";
import { stripCustomPayloadFlag } from "../../open-sse/payload/jailbreakPayloads.js";

describe("custom payload category flag is stripped from the payload body", () => {
  it("removes a leading flag and the blank line it leaves behind", () => {
    expect(stripCustomPayloadFlag("cat: general\n# SKILL\n\nbody")).toBe("# SKILL\n\nbody");
  });

  it("removes the flag when it sits within the loader's 3-line window", () => {
    expect(stripCustomPayloadFlag("<!-- x -->\ncat: coding\n# Title")).toBe("<!-- x -->\n# Title");
  });

  it("keeps CRLF endings intact on Windows-authored files", () => {
    expect(stripCustomPayloadFlag("cat: coding\r\nline one\r\nline two")).toBe("line one\r\nline two");
  });

  it("leaves text without a flag untouched", () => {
    const text = "# Title\ncat: not-a-flag-line-suffix\nbody";
    expect(stripCustomPayloadFlag(text)).toBe(text);
  });

  it("does not touch a `cat:` mention that is part of prose", () => {
    const text = "# Title\nuse cat: to inspect files\nbody";
    expect(stripCustomPayloadFlag(text)).toBe(text);
  });

  it("strips only the first flag, never a second one deeper in the text", () => {
    expect(stripCustomPayloadFlag("cat: coding\nheading\ncat: pentest")).toBe("heading\ncat: pentest");
  });

  it("handles empty input", () => {
    expect(stripCustomPayloadFlag("")).toBe("");
    expect(stripCustomPayloadFlag(null)).toBe("");
  });
});
