// Custom node providers (openai-compatible-*) — baseUrl from credentials.
// Unlike the embedding twin, this REFUSES without baseUrl: defaulting to
// api.openai.com would ship the user's key to OpenAI.
import createOpenAIAdapter from "./openai.js";

const baseAdapter = createOpenAIAdapter("openai");

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl;
    if (!rawBaseUrl) throw new Error("No base URL configured for image provider");
    return `${rawBaseUrl.replace(/\/$/, "")}/images/generations`;
  },
};
