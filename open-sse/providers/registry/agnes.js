export default {
  id: "agnes",
  priority: 120,
  alias: "agnes",
  aliases: [
    "agnes-ai",
  ],
  uiAlias: "agnes",
  display: {
    name: "Agnes AI",
    icon: "auto_awesome",
    color: "#7C3AED",
    textIcon: "AG",
    website: "https://agnes-ai.com",
    notice: {
      text: "OpenAI-compatible gateway from Agnes AI, offering free API credits on sign-up. Accepts a bearer token or an x-api-key header.",
      apiKeyUrl: "https://platform.agnes-ai.com",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  // Media capabilities — Agnes exposes OpenAI-compatible image generation
  // (POST /v1/images/generations) and async video jobs (POST /v1/videos,
  // poll GET /agnesapi?video_id=<id>&model_name=<model>). The video wire
  // format is non-standard (custom poll path + query params), so a dedicated
  // adapter in open-sse/handlers/videoProviders/agnes.js handles it.
  imageConfig: {
    baseUrl: "https://apihub.agnes-ai.com/v1/images/generations",
  },
  videoConfig: {
    baseUrl: "https://apihub.agnes-ai.com/v1/videos",
  },
  serviceKinds: ["llm", "image", "video"],
  // Seeds so the dashboard has something to show before a key is saved and
  // /v1/models answers with a usable list. The live catalogue at
  // apihub.agnes-ai.com/v1/models requires a token (401 "Token not provided"),
  // so these ids are a curated starting set rather than a verified dump —
  // passthroughModels below still accepts any id the account actually has.
  models: [
    { id: "agnes-2.5-flash", name: "Agnes 2.5 Flash" },
    { id: "agnes-2.5-pro", name: "Agnes 2.5 Pro" },
    { id: "agnes-2.5-pro-beta", name: "Agnes 2.5 Pro Beta" },
    { id: "agnes-3.0-flash", name: "Agnes 3.0 Flash" },
  ],
  passthroughModels: true,
};
