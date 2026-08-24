import { describe, expect, it } from "vitest";

// Path from tests/ to repo-root shared lib (vitest.config resolves @/ too,
// but plain relative keeps this file independent of alias config).
import { rankResults, scoreResponse } from "../../src/shared/lib/plinianScoring";

const QUERY = "how do I write a debounce function in javascript";

const GOOD = [
  "# Debounce in JavaScript",
  "",
  "A debounce delays invocation until input settles.",
  "",
  "```js",
  "function debounce(fn, ms = 300) {",
  "  let t;",
  "  return (...args) => {",
  "    clearTimeout(t);",
  "    t = setTimeout(() => fn(...args), ms);",
  "  };",
  "}",
  "```",
  "",
  "## How it works",
  "- every call resets the timer",
  "- only the final call fires",
  "- use for resize, keyup, search inputs",
].join("\n");

const HEDGY =
  "I apologize, but I am not able to help with that. It is important to note that you should consult documentation instead. As an AI, I must decline.";

const PREAMBLE = "Sure! Here is a debounce implementation for javascript.";

describe("plinianScoring.scoreResponse", () => {
  it("scores structured substantive answers highest", () => {
    expect(scoreResponse(GOOD, QUERY)).toBeGreaterThan(60);
  });

  it("heavily penalises hedging refusals", () => {
    const score = scoreResponse(HEDGY, QUERY);
    expect(score).toBeLessThan(30);
    expect(score).toBeGreaterThan(0);
  });

  it("penalises preamble openers but keeps content score", () => {
    expect(scoreResponse(PREAMBLE, QUERY)).toBeLessThan(scoreResponse(GOOD, QUERY));
  });

  it("returns 0 for empty or trivial content", () => {
    expect(scoreResponse("", QUERY)).toBe(0);
    expect(scoreResponse("ok", QUERY)).toBe(0);
  });

  it("caps at 100", () => {
    expect(scoreResponse(GOOD.repeat(50), QUERY)).toBeLessThanOrEqual(100);
  });
});

describe("rankResults", () => {
  it("sorts best-first and never ranks failed racers above scored ones", () => {
    const ranked = rankResults(
      [
        { model: "failed", content: "", duration_ms: 100, success: false },
        { model: "good", content: GOOD, duration_ms: 4000, success: true },
        { model: "hedger", content: HEDGY, duration_ms: 800, success: true },
        { model: "preamble", content: PREAMBLE, duration_ms: 1200, success: true },
      ],
      QUERY
    );
    expect(ranked.map((r) => r.model)).toEqual(["good", "preamble", "hedger", "failed"]);
  });

  it("breaks score ties by faster duration", () => {
    const ranked = rankResults(
      [
        { model: "slow", content: PREAMBLE, duration_ms: 2000, success: true },
        { model: "fast", content: PREAMBLE, duration_ms: 500, success: true },
      ],
      QUERY
    );
    expect(ranked[0].model).toBe("fast");
  });
});
