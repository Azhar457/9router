import { describe, expect, it } from "vitest";
import { classify, suggestParams } from "../../src/shared/lib/autotuneLite";

describe("autotuneLite", () => {
  it("classifies fenced code as code", () => {
    expect(classify("fix this:\n```js\nfoo()\n```")).toBe("code");
    expect(suggestParams("refactor the api endpoint handler").context).toBe("code");
    expect(suggestParams("refactor the api endpoint handler").temperature).toBeLessThan(0.5);
  });

  it("defaults casual greetings to conversational profile", () => {
    const p = suggestParams("hello who are you");
    expect(p.context).toBe("conversational");
    expect(p.temperature).toBeCloseTo(0.7);
  });

  it("raises temperature for creative asks", () => {
    expect(suggestParams("write me a short story about a lighthouse").temperature).toBeGreaterThan(0.8);
  });
});
