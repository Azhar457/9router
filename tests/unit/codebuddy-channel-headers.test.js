import { describe, it, expect } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";
import { getExecutor } from "open-sse/executors/index.js";

// The CodeBuddy gateways (CN + intl) run a per-request channel check. Without
// the official plugin's request/conversation identifiers upstream rejects the
// call with 400 / 11128 "request illegal" ("failed channel verification").
// These tests lock the header wiring so the ids cannot silently disappear.
const REQUIRED = [
  "X-Request-ID",
  "X-Conversation-ID",
  "X-Conversation-Request-ID",
  "X-Conversation-Message-ID",
];

const CREDS = { accessToken: "TESTTOKEN", apiKey: null };

async function buildHeaders(id) {
  const executor = await getExecutor(id);
  return executor.buildHeaders(CREDS, true, PROVIDERS[id].baseUrl, "deepseek-v4.1-flash", {});
}

describe("codebuddy channel headers", () => {
  for (const id of ["codebuddy-intl", "codebuddy-cn"]) {
    describe(id, () => {
      it("registers the codebuddyHeaders hook", async () => {
        expect(PROVIDERS[id]?.auth?.hooks).toContain("codebuddyHeaders");
      });

      it("sends the plugin request/conversation ids", async () => {
        const headers = await buildHeaders(id);
        for (const key of REQUIRED) {
          expect(typeof headers[key], `${id} must send ${key}`).toBe("string");
          expect(headers[key].length).toBeGreaterThan(0);
        }
      });

      it("reuses one request id across the request/conversation pair", async () => {
        const headers = await buildHeaders(id);
        expect(headers["X-Request-ID"]).toBe(headers["X-Conversation-Request-ID"]);
        expect(headers["X-Conversation-ID"]).not.toBe(headers["X-Conversation-Message-ID"]);
      });

      it("still applies the bearer token after the hook runs", async () => {
        expect((await buildHeaders(id)).Authorization).toBe("Bearer TESTTOKEN");
      });

      it("issues fresh ids per request", async () => {
        const a = await buildHeaders(id);
        const b = await buildHeaders(id);
        expect(a["X-Request-ID"]).not.toBe(b["X-Request-ID"]);
        expect(a["X-Conversation-ID"]).not.toBe(b["X-Conversation-ID"]);
      });
    });
  }
});
