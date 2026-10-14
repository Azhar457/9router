import { describe, expect, it } from "vitest";
import { getVideoConfig, getVideoConfigForNode } from "../../open-sse/handlers/videoCore.js";

describe("getVideoConfigForNode (node-synthesized video config)", () => {
  it("returns registry config when present", () => {
    // 'agnes' has a registry videoConfig
    const cfg = getVideoConfig("agnes");
    expect(cfg).toBeTruthy();
    expect(getVideoConfigForNode("agnes")).toBe(cfg);
  });

  it("synthesizes config from openai-compatible node credentials baseUrl", () => {
    const provider = "openai-compatible-chat-7c5ade4d-7902-4c2f-b3c3-0bb6b59a9594";
    const creds = { providerSpecificData: { baseUrl: "https://apihub.agnes-ai.com/v1" } };
    const cfg = getVideoConfigForNode(provider, creds);
    expect(cfg).toEqual({ baseUrl: "https://apihub.agnes-ai.com/v1", fromNode: true });
  });

  it("returns null for non-node providers without a registry config", () => {
    expect(getVideoConfigForNode("unknown-provider", {})).toBeNull();
  });

  it("returns null for node without baseUrl", () => {
    const provider = "openai-compatible-chat-000";
    expect(getVideoConfigForNode(provider, { providerSpecificData: {} })).toBeNull();
  });
});
