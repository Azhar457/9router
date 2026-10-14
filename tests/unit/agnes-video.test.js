import { describe, expect, it } from "vitest";
import agnes from "../../open-sse/handlers/videoProviders/agnes.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const config = { baseUrl: "https://apihub.agnes-ai.com/v1" };

describe("agnes video adapter", () => {
  it("POSTs create to {base}/videos (strip /videos suffix)", () => {
    const r = agnes.buildRequest({
      config,
      action: "generations",
      rawBody: JSON.stringify({ model: "agnes-video-2.5", prompt: "a cat" }),
      contentType: "application/json",
      token: "sk-test",
    });
    expect(r.method).toBe("POST");
    expect(r.url).toBe("https://apihub.agnes-ai.com/v1/videos");
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(r.headers.Authorization).toBe("Bearer sk-test");
    expect(r.body).toBe(JSON.stringify({ model: "agnes-video-2.5", prompt: "a cat" }));
  });

  it("GETs poll at {root}/agnesapi?video_id=", () => {
    const r = agnes.buildRequest({
      config,
      action: null,
      requestId: "vid-123",
      token: "sk-test",
    });
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://apihub.agnes-ai.com/agnesapi?video_id=vid-123");
    expect(r.headers.Authorization).toBe("Bearer sk-test");
  });

  it("registry agnes exposes videoConfig + serviceKinds", () => {
    expect(PROVIDER_MEDIA["agnes"]?.videoConfig).toBeTruthy();
    expect(PROVIDER_MEDIA["agnes"]?.serviceKinds).toContain("video");
    expect(PROVIDER_MEDIA["agnes"]?.serviceKinds).toContain("image");
  });

  it("accepts edits/extensions, rejects unknown action", () => {
    expect(agnes.buildRequest({ config, action: "edits", rawBody: "{}", token: "k" }).method).toBe("POST");
    const bad = agnes.buildRequest({ config, action: "weird", rawBody: "{}", token: "k" });
    expect(bad.error).toContain("Agnes video supports");
  });
});
