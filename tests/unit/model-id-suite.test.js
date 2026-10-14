import { describe, expect, it } from "vitest";
import { MODEL_ID_PAYLOADS, SUITE_ORDER, SUITE_LABELS } from "../../src/shared/constants/modelIdSuite/payloads.js";

describe("model-ID payload suite data integrity", () => {
  it("every suite in SUITE_ORDER has a matching payload key", () => {
    for (const suite of SUITE_ORDER) {
      expect(MODEL_ID_PAYLOADS[suite], `missing payloads for ${suite}`).toBeDefined();
      expect(MODEL_ID_PAYLOADS[suite].length, `${suite} empty`).toBeGreaterThan(0);
    }
  });

  it("payload count matches the xlsx source (74 total)", () => {
    const total = Object.values(MODEL_ID_PAYLOADS).reduce((sum, v) => sum + v.length, 0);
    expect(total).toBe(74);
  });

  it("each payload has the required fields", () => {
    for (const [suite, items] of Object.entries(MODEL_ID_PAYLOADS)) {
      for (const p of items) {
        expect(p.id, `${suite} item missing id`).toBeTruthy();
        expect(typeof p.payload, `${suite}/${p.id} payload not string`).toBe("string");
        expect(SUITE_LABELS[suite], `missing label for ${suite}`).toBeDefined();
      }
    }
  });

  it("E-series payloads carry the <MODEL> placeholder for substitution", () => {
    for (const p of MODEL_ID_PAYLOADS["E_APISurface"]) {
      expect(p.payload).toContain("<MODEL>");
    }
  });
});
