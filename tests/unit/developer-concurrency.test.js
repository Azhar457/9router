import { describe, expect, it } from "vitest";
import {
  MAX_PROVIDER_CONCURRENCY,
  PER_KEY_CONCURRENCY,
  providerBudget,
  runPooled,
} from "../../src/shared/lib/concurrency.js";

// The Developer page fires N requests per provider through a single provider
// credential. These tests pin the two properties that matter: we never exceed
// the key budget, and we never stall behind a slow sibling.

const tick = () => new Promise((r) => setTimeout(r, 1));

/** Tracks the peak simultaneous run per key so we can assert the cap held. */
function makeTracker() {
  const live = new Map();
  const peak = new Map();
  return {
    enter(key) {
      const next = (live.get(key) || 0) + 1;
      live.set(key, next);
      peak.set(key, Math.max(peak.get(key) || 0, next));
    },
    exit(key) {
      live.set(key, live.get(key) - 1);
    },
    peak,
  };
}

describe("providerBudget", () => {
  it("ignores extra keys under fill-first, which pins every request to one", () => {
    expect(providerBudget({ connections: 1 }, "fill-first")).toBe(PER_KEY_CONCURRENCY);
    expect(providerBudget({ connections: 12 }, "fill-first")).toBe(PER_KEY_CONCURRENCY);
  });

  it("scales with the key pool under round-robin", () => {
    expect(providerBudget({ connections: 3 }, "round-robin")).toBe(3 * PER_KEY_CONCURRENCY);
    expect(providerBudget({}, "round-robin")).toBe(PER_KEY_CONCURRENCY);
    expect(providerBudget({ connections: 0 }, "round-robin")).toBe(PER_KEY_CONCURRENCY);
  });

  it("clamps to the ceiling and never returns zero", () => {
    expect(providerBudget({ connections: 999 }, "round-robin")).toBe(MAX_PROVIDER_CONCURRENCY);
    expect(providerBudget(null, undefined)).toBeGreaterThanOrEqual(1);
  });
});

describe("runPooled", () => {
  it("never exceeds the per-key budget", async () => {
    const tracker = makeTracker();
    const items = Array.from({ length: 40 }, (_, i) => ({ key: i % 2 ? "a" : "b" }));

    await runPooled(
      items,
      async (item) => {
        tracker.enter(item.key);
        await tick();
        tracker.exit(item.key);
      },
      { keyFor: (i) => i.key, budgetFor: () => 2 }
    );

    expect(tracker.peak.get("a")).toBeLessThanOrEqual(2);
    expect(tracker.peak.get("b")).toBeLessThanOrEqual(2);
  });

  it("uses the whole budget instead of serialising on the first key", async () => {
    const tracker = makeTracker();
    const items = Array.from({ length: 8 }, () => ({ key: "solo" }));

    await runPooled(
      items,
      async (item) => {
        tracker.enter(item.key);
        await tick();
        tracker.exit(item.key);
      },
      { keyFor: (i) => i.key, budgetFor: () => 4 }
    );

    expect(tracker.peak.get("solo")).toBe(4);
  });

  it("does not let one slow item stall the rest of its wave", async () => {
    const order = [];
    const items = [
      { id: "slow", ms: 60 },
      { id: "b", ms: 1 },
      { id: "c", ms: 1 },
      { id: "d", ms: 1 },
    ];

    await runPooled(
      items,
      async (item) => {
        await new Promise((r) => setTimeout(r, item.ms));
        order.push(item.id);
      },
      { budgetFor: () => 4 }
    );

    // The old wave scheduler finished these as one batch, so all four landed
    // together after 60ms. The semaphore lets the fast three finish first.
    expect(order).toEqual(["b", "c", "d", "slow"]);
  });

  it("returns results in input order regardless of completion order", async () => {
    const items = [{ ms: 30 }, { ms: 1 }, { ms: 15 }];
    const out = await runPooled(
      items,
      (item) => new Promise((r) => setTimeout(() => r(item.ms), item.ms)),
      { budgetFor: () => 3 }
    );
    expect(out).toEqual([30, 1, 15]);
  });

  it("settles every item before throwing, then surfaces the first error", async () => {
    let completed = 0;
    const items = ["ok-1", "boom", "ok-2"];

    await expect(
      runPooled(
        items,
        async (id) => {
          await tick();
          if (id === "boom") throw new Error("rate limited");
          completed += 1;
        },
        { budgetFor: () => 3 }
      )
    ).rejects.toThrow("rate limited");

    expect(completed).toBe(2);
  });

  it("resolves immediately for an empty run", async () => {
    await expect(runPooled([], async () => "never")).resolves.toEqual([]);
  });
});