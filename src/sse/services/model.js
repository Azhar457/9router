// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    // Fallback: OpenRouter-flavored ids typed without the double
    // `openrouter/openrouter/` prefix. Clients that strip one prefix (LiteLLM
    // inside Strix) send bare vendor ids like `poolside/laguna-xs-2.1:free`.
    //  1. Unknown first segment → the whole string is the OpenRouter id.
    //  2. Known (non-openrouter) provider, but the id ends with `:free` —
    //     OpenRouter's free-tier marker that direct providers don't register —
    //     and it's not in that provider's static model list → route via
    //     OpenRouter instead of failing with "No active credentials".
    if (
      !RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias) &&
      !RESERVED_PROVIDER_PREFIXES.has(parsed.provider) &&
      typeof parsed.model === "string" &&
      parsed.model.length > 0
    ) {
      return { provider: "openrouter", model: modelStr };
    }
    // Providers with `passthroughModels: true` (kilocode, opencode, venice, zed,
    // vercel-ai-gateway, ...) serve their own dynamic catalog — `:free` ids are
    // valid for them directly, so never redirect them to openrouter.
    if (
      typeof modelStr === "string" &&
      /:free$/.test(modelStr) &&
      parsed.providerAlias !== "openrouter" &&
      typeof parsed.model === "string" &&
      parsed.model.length > 0
    ) {
      const registryEntry = REGISTRY.find(
        (entry) =>
          entry.id === parsed.providerAlias ||
          entry.alias === parsed.providerAlias ||
          (entry.aliases || []).includes(parsed.providerAlias)
      );
      if (!registryEntry?.passthroughModels) {
        const registeredIds = new Set((registryEntry?.models || []).map((m) => m.id));
        // Compare the bare model (no provider prefix) against the provider's static list
        if (!registeredIds.has(parsed.model)) {
          return { provider: "openrouter", model: modelStr };
        }
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
