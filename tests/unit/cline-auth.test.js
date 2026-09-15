import { test } from "vitest";
import { expect } from "vitest";
import {
  getClineAccessToken,
  getClineAuthorizationHeader,
} from "../../open-sse/shared/clineAuth.js";

test("getClineAccessToken keeps an existing workos: prefix", () => {
  const token = "workos:eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
  expect(getClineAccessToken(token), token);
  expect(getClineAccessToken(`  ${token}  `), token);
});

test("getClineAccessToken prefixes a bare WorkOS JWT with workos:", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJwYXAiJ9";
  expect(getClineAccessToken(jwt), `workos:${jwt}`);
});

test("getClineAccessToken does NOT prefix ClinePass API keys", () => {
  // ClinePass API keys are opaque strings (e.g. clp_…). Sending them as
  // `workos:clp_…` makes api.cline.bot respond 401.
  expect(getClineAccessToken("clp_1234567890abcdef"), "clp_1234567890abcdef");
  expect(getClineAccessToken("sk-9r-abcdef"), "sk-9r-abcdef");
  expect(getClineAccessToken(""), "");
  expect(getClineAccessToken("   "), "");
  expect(getClineAccessToken(undefined), "");
  expect(getClineAccessToken(null), "");
});

test("getClineAuthorizationHeader builds a Bearer header without double prefixing", () => {
  expect(getClineAuthorizationHeader("clp_abc"), "Bearer clp_abc");
  expect(
    getClineAuthorizationHeader("eyJpeg.eyJbG"),
    "Bearer workos:eyJpeg.eyJbG"
  );
  expect(
    getClineAuthorizationHeader("workos:eyJpeg.eyJbG"),
    "Bearer workos:eyJpeg.eyJbG"
  );
});