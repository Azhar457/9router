// Executor registry.
//
// Executors load on first use rather than at module scope. There are ~38 of them
// and most are reachable for exactly one provider, so static imports dragged every
// executor's module graph (and its dependencies) into the server process even when
// only one provider was ever called. The class re-exports this module used to carry
// were unused anywhere and forced the same eager load, so they are gone.
//
// `getExecutor` is therefore async: callers `await` it once per request. Instances
// are still singletons — the cache below preserves the old `new X()` semantics.

import { DefaultExecutor } from "./default.js";

const LOADERS = {
  antigravity: async () => new (await import("./antigravity.js")).AntigravityExecutor(),
  azure: async () => new (await import("./azure.js")).AzureExecutor(),
  "gemini-cli": async () => new (await import("./gemini-cli.js")).GeminiCLIExecutor(),
  github: async () => new (await import("./github.js")).GithubExecutor(),
  iflow: async () => new (await import("./iflow.js")).IFlowExecutor(),
  qoder: async () => new (await import("./qoder.js")).QoderExecutor(),
  "qoder-cn": async () => new (await import("./qoder.js")).QoderExecutor("qoder-cn"),
  kiro: async () => new (await import("./kiro.js")).KiroExecutor(),
  kimchi: async () => new (await import("./kimchi.js")).KimchiExecutor(),
  codex: async () => new (await import("./codex.js")).CodexExecutor(),
  cursor: async () => new (await import("./cursor.js")).CursorExecutor(),
  cu: async () => new (await import("./cursor.js")).CursorExecutor(), // Alias for cursor
  vertex: async () => new (await import("./vertex.js")).VertexExecutor("vertex"),
  "vertex-partner": async () => new (await import("./vertex.js")).VertexExecutor("vertex-partner"),
  opencode: async () => new (await import("./opencode.js")).OpenCodeExecutor(),
  "opencode-go": async () => new (await import("./opencode-go.js")).OpenCodeGoExecutor(),
  "opencode-zen": async () => new (await import("./opencode-zen.js")).OpenCodeZenExecutor(),
  "grok-web": async () => new (await import("./grok-web.js")).GrokWebExecutor(),
  "grok-cli": async () => new (await import("./grok-cli.js")).GrokCliExecutor(),
  gcli: async () => new (await import("./grok-cli.js")).GrokCliExecutor(), // Alias
  gb: async () => new (await import("./grok-cli.js")).GrokCliExecutor(), // Alias (Grok Build)
  "perplexity-web": async () => new (await import("./perplexity-web.js")).PerplexityWebExecutor(),
  "deepseek-web": async () => new (await import("./deepseek-web.js")).DeepSeekWebExecutor(),
  "gemini-web": async () => new (await import("./gemini-web.js")).GeminiWebExecutor(),
  "muse-web": async () => new (await import("./muse-web.js")).MuseWebExecutor(),
  "veoaifree-web": async () => new (await import("./veoaifree-web.js")).VeoAiFreeWebExecutor(),
  "veo-free": async () => new (await import("./veoaifree-web.js")).VeoAiFreeWebExecutor(), // Alias
  "uc-web": async () => new (await import("./uc-web.js")).UcWebExecutor(),
  "chatgpt-web": async () => new (await import("./chatgpt-web.js")).ChatGptWebExecutor(),
  "ollama-local": async () => new (await import("./ollama-local.js")).OllamaLocalExecutor(),
  commandcode: async () => new (await import("./commandcode.js")).CommandCodeExecutor(),
  "xiaomi-tokenplan": async () => new (await import("./xiaomi-tokenplan.js")).XiaomiTokenplanExecutor(),
  "xiaomi-mimo": async () => new (await import("./xiaomi-mimo.js")).XiaomiMimoExecutor(),
  "mimo-free": async () => new (await import("./mimo-free.js")).MimoFreeExecutor(),
  mmf: async () => new (await import("./mimo-free.js")).MimoFreeExecutor(), // Alias for mimo-free
  "codebuddy-cn": async () => new (await import("./codebuddy-cn.js")).CodeBuddyExecutor(),
  "codebuddy-intl": async () => new (await import("./codebuddy-intl.js")).CodeBuddyIntlExecutor(),
  trae: async () => new (await import("./trae.js")).default(),
  zed: async () => new (await import("./zed.js")).default(),
  windsurf: async () => new (await import("./windsurf.js")).default(),
  "minimax-code": async () => new (await import("./minimax-code.js")).MinimaxCodeExecutor("minimax-code"),
  "minimax-code-global": async () => new (await import("./minimax-code.js")).MinimaxCodeExecutor("minimax-code-global"),
  "devin-cli": async () => new (await import("./devin-cli.js")).DevinCliExecutor(),
  bedrock: async () => new (await import("./bedrock.js")).BedrockExecutor(),
  br: async () => new (await import("./bedrock.js")).BedrockExecutor(), // Alias for bedrock
  // Second Bedrock entry for xAI's Grok, which speaks OpenAI Chat Completions rather than the
  // Anthropic Messages format. Same executor, different registry transport format — the pattern
  // vertex / vertex-partner already uses.
  "bedrock-xai": async () => new (await import("./bedrock.js")).BedrockExecutor("bedrock-xai"),
  brx: async () => new (await import("./bedrock.js")).BedrockExecutor("bedrock-xai"), // Alias for bedrock-xai
};

const instanceCache = new Map();
const defaultCache = new Map();

export async function getExecutor(provider) {
  if (instanceCache.has(provider)) return instanceCache.get(provider);
  const loader = LOADERS[provider];
  if (!loader) {
    if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
    return defaultCache.get(provider);
  }
  const instance = await loader();
  instanceCache.set(provider, instance);
  return instance;
}

export function hasSpecializedExecutor(provider) {
  return !!LOADERS[provider];
}

export { BaseExecutor } from "./base.js";
export { DefaultExecutor } from "./default.js";
