// Auto-load free models from the public catalogs of 9router's own providers.
//
// Every registry entry with a `modelsFetcher` already powers the dashboard's
// "suggested models" panel; this module turns the same pipeline into a
// background sync: fetch the catalog, run it through the shared FILTERS
// (free-only types), and upsert new free models as custom models via
// addCustomModel. Purely additive — static registry and routing untouched.
//
// No OmniRoute involved: the catalogs are the providers' own public endpoints
// (openrouter.ai, api.kilo.ai, opencode.ai, models.dev, api.airforce...).

import { addCustomModel, getCustomModels, getProviderConnections } from "@/models";
import { knownModelKeys, sortFreeFirst } from "./omniSync.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";

const FETCH_TIMEOUT_MS = 15_000;
const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_DELAY_MS = 60 * 1000;

/**
 * Providers whose suggested-models filter produces a free-model list.
 * Only these are auto-imported: the filter result is by construction the
 * free set, so every imported model carries caps.isFree.
 */
function freeFetcherEntries() {
  return REGISTRY.filter((entry) => {
    const type = entry.modelsFetcher?.type;
    return type && FILTERS[type] && !entry.hidden;
  });
}

/** Fetch a catalog URL the same way the suggested-models proxy does. */
async function fetchCatalog(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const raw = json.data ?? json.models ?? json;
  return Array.isArray(raw) ? raw : [];
}

/**
 * Run one pass: for every free-fetching provider, import the unknown free
 * models as custom models.
 * @returns {Promise<{providers:number, imported:number, skipped:number, errors:Record<string,string>, importedModels:Array<{providerAlias:string,id:string,isFree:boolean}>}>}
 */
export async function syncProviderFreeModels() {
  const connections = await getProviderConnections();
  const activeProviderIds = new Set((connections || []).map((c) => c.provider));
  // noAuth catalogs need no connection; others only matter when the user
  // has at least one live connection for that provider (otherwise the
  // imported custom models can never be routed).
  const candidates = freeFetcherEntries().filter(
    (entry) => entry.noAuth || activeProviderIds.has(entry.id)
  );

  const known = knownModelKeys();
  const custom = new Map(
    (await getCustomModels()).map((m) => [`${m.providerAlias}|${m.id}`, m])
  );
  const errors = {};
  const importedModels = [];
  let imported = 0;
  let skipped = 0;

  for (const entry of candidates) {
    const filter = FILTERS[entry.modelsFetcher.type];
    let models;
    try {
      models = filter(await fetchCatalog(entry.modelsFetcher.url));
    } catch (err) {
      errors[entry.id] = err?.message || String(err);
      continue;
    }
    for (const m of models || []) {
      if (!m?.id) continue;
      const alias = entry.alias || entry.id;
      const key = `${alias}|${m.id}`;
      if (known.has(key) || custom.has(key)) {
        skipped++;
        continue;
      }
      await addCustomModel({
        providerAlias: alias,
        id: m.id,
        type: "llm",
        name: m.name || m.id,
        caps: { isFree: true },
      });
      custom.set(key, {});
      imported++;
      importedModels.push({ providerAlias: alias, id: m.id, isFree: true });
    }
  }

  return {
    providers: candidates.length,
    imported,
    skipped,
    errors,
    importedModels: sortFreeFirst(importedModels),
  };
}

// ── Scheduler ─────────────────────────────────────────────────

let timer = null;

/**
 * Start the recurring provider free-model sync.
 * Default on; disable with PROVIDER_SYNC=off.
 */
export function startProviderFreeModelSync() {
  if (timer) return;
  if (String(process.env.PROVIDER_SYNC || "").toLowerCase() === "off") return;

  const schedule = (delay) => {
    timer = setTimeout(async () => {
      const result = await syncProviderFreeModels();
      if (result.imported > 0) {
        console.log(`[provider-sync] imported ${result.imported} free model(s) from ${result.providers} provider catalog(s)`);
      }
      for (const [id, err] of Object.entries(result.errors)) {
        console.log(`[provider-sync] ${id} catalog fetch failed: ${err}`);
      }
      schedule(SYNC_INTERVAL_MS);
    }, delay);
    timer.unref?.();
  };
  schedule(STARTUP_DELAY_MS);
}
