// Auto-detect models from a running OmniRoute instance and import the new ones
// into 9router as custom models.
//
// Design: purely additive. Every import goes through addCustomModel, which
// upserts — re-adding an existing model only refreshes caps/name, never resets
// fields (aliasRepo.js). The static PROVIDER_MODELS registry and routing are
// untouched.
//
// Source: OmniRoute GET /v1/models (OpenAI-compatible). Rows carry
// { id, owned_by, root } — id is alias-prefixed ("kc/foo:free"), owned_by the
// canonical provider id, root the provider-relative model id. OmniRoute marks
// openrouter free rows with `free: true`; static rows have no flag, so free
// detection falls back to the `:free` id suffix (same rule as
// OmniRoute's isOpenRouterFreeModel).

import { addCustomModel, getCustomModels } from "@/models";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

const FETCH_TIMEOUT_MS = 30_000;

// ── Free / paid ────────────────────────────────────────────────

function isZeroPrice(v) {
  return v == null || String(v) === "0" || Number(v) === 0;
}

/** Free signals, strongest first: explicit flag, `:free` id suffix, zero prices. */
export function isFreeModel(m) {
  if (m.free === true) return true;
  const id = String(m.id || m.root || "");
  if (id.endsWith(":free")) return true;
  const p = m.pricing;
  if (p && isZeroPrice(p.prompt) && isZeroPrice(p.completion)) return true;
  return false;
}

/** Stable "free first" sort: free before paid, ties alphabetical. No mutation. */
export function sortFreeFirst(list) {
  return [...list].sort((a, b) => {
    const af = isFreeModel(a) ? 0 : 1;
    const bf = isFreeModel(b) ? 0 : 1;
    if (af !== bf) return af - bf;
    return String(a.id || a.name || "").localeCompare(String(b.id || b.name || ""));
  });
}

// ── Import ─────────────────────────────────────────────────────

/**
 * Normalize an OmniRoute /v1/models row into a 9router custom-model spec.
 * Returns null for rows that are not importable: combos, missing root,
 * virtual auto/* routing ids.
 */
export function toCustomSpec(row) {
  if (!row || typeof row !== "object") return null;
  const ownedBy = String(row.owned_by || "");
  const rawRoot = String(row.root || "");
  if (!ownedBy || ownedBy === "combo") return null;
  if (!rawRoot) return null;
  if (rawRoot.startsWith("auto/")) return null; // virtual OmniRoute routing ids
  // ponytail: keep sub-path roots ("nvidia/nemotron-x") — gateway catalogs nest.
  const alias = PROVIDER_ID_TO_ALIAS[ownedBy] || ownedBy;
  const isFree = isFreeModel(row);
  return {
    providerAlias: alias,
    id: rawRoot,
    type: row.type || "llm",
    name: row.name || rawRoot,
    // The API route's caps sanitizer keeps only CAPACITY_META booleans, but
    // the lib-level addCustomModel keeps arbitrary caps, so store the flag
    // here for free/paid sort and dashboard use.
    caps: isFree ? { isFree: true } : undefined,
  };
}

/** Keys of models already known locally (static registry + custom store). */
export function knownModelKeys() {
  const keys = new Set();
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    for (const m of models || []) keys.add(`${alias}|${m.id}`);
  }
  return keys;
}

/**
 * Fetch OmniRoute's model list and import the unknown ones as custom models.
 * @returns {Promise<{synced:number, skipped:number, added:Array<{providerAlias:string,id:string,isFree:boolean}>, error:string|null}>}
 */
export async function syncOmniRouteModels({ baseUrl, freeOnly = false } = {}) {
  const base = String(baseUrl || process.env.OMNIROUTE_URL || "").replace(/\/$/, "");
  if (!base) {
    return { synced: 0, skipped: 0, added: [], error: "no OmniRoute URL (set OMNIROUTE_URL or pass baseUrl)" };
  }

  let rows;
  try {
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { synced: 0, skipped: 0, added: [], error: `OmniRoute /v1/models returned ${res.status}` };
    }
    const json = await res.json();
    rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  } catch (err) {
    return { synced: 0, skipped: 0, added: [], error: err?.message || String(err) };
  }

  // De-dup: alias and canonical rows for the same model can both exist
  // ("kc/x:free" + "kilocode/x:free") — one import per (alias, root).
  const seen = new Set();
  const specs = [];
  for (const row of rows) {
    const spec = toCustomSpec(row);
    if (!spec) continue;
    if (freeOnly && !spec.caps?.isFree) continue;
    const k = `${spec.providerAlias}|${spec.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    specs.push(spec);
  }

  const known = knownModelKeys();
  const custom = new Map(
    (await getCustomModels()).map((m) => [`${m.providerAlias}|${m.id}`, m])
  );
  const toAdd = specs.filter(
    (s) => !known.has(`${s.providerAlias}|${s.id}`) && !custom.has(`${s.providerAlias}|${s.id}`)
  );

  const added = [];
  for (const s of toAdd) {
    await addCustomModel(s);
    added.push({ providerAlias: s.providerAlias, id: s.id, isFree: !!s.caps?.isFree });
  }

  return {
    synced: added.length,
    skipped: specs.length - toAdd.length,
    added: sortFreeFirst(added),
    error: null,
  };
}

// ── Auto-detect scheduler ─────────────────────────────────────
// Mirror of startModelCatalogSync: 30-minute poll, off switch, unref.
const OMNI_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const OMNI_STARTUP_DELAY_MS = 30 * 1000;
let omniTimer = null;

/**
 * Start the recurring OmniRoute -> 9router auto-detect sync.
 * Only active when OMNIROUTE_URL is set. Disable with OMNI_SYNC=off.
 */
export function startOmniRouteSync() {
  if (omniTimer) return;
  if (String(process.env.OMNI_SYNC || "").toLowerCase() === "off") return;
  if (!process.env.OMNIROUTE_URL) return;

  const schedule = (delay) => {
    omniTimer = setTimeout(async () => {
      const result = await syncOmniRouteModels({});
      if (result.error) console.log(`[omni-sync] ${result.error}`);
      else if (result.synced > 0) console.log(`[omni-sync] imported ${result.synced} model(s) from OmniRoute`);
      schedule(OMNI_SYNC_INTERVAL_MS);
    }, delay);
    omniTimer.unref?.();
  };
  schedule(OMNI_STARTUP_DELAY_MS);
}
