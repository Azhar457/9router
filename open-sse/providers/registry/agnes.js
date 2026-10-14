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
  // No model ids could be verified without a key, so discovery is left to the
  // live endpoint and any id is accepted through passthroughModels.
  passthroughModels: true,
};
