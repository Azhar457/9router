// Auto-curate a "FreeTier" combo: pick the single best free model per model
// family, verified against the accounts that are actually available.
//
// Flow (mirrors the user's spec):
//   1. List every free model we know (custom registry with caps.isFree, static
//      registry free rows, plus a live pass of the provider free catalogs —
//      the same pipeline providerSync uses, run in-memory without upserts).
//   2. "Test if usable with the account we have" — ping each via the internal
//      chat endpoint (pingModelByKind). Failures here drop the candidate.
//   3. Benchmark — run one racing prompt across the survivors, keep the
//      fastest-usable winner per family (latency + non-empty answer).
//   4. Build one combo name (default "FreeTier") from the winners.
//
// No OmniRoute dependency. Purely additive — it never mutates the static
// registry or any model, only upserts the named combo.

import { getCustomModels, getProviderConnections } from "@/models";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";
import { isFreeModel } from "./omniSync.js";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import REGISTRY from "open-sse/providers/registry/index.js";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";

const FETCH_TIMEOUT_MS = 15000;
const PING_CONCURRENCY = 8;

// ── Family buckets ─────────────────────────────────────────────
// "Best 1 per family": group free models into coarse capability families.
// The combo keeps exactly one (the winner) per family so its members span
// different kinds (coding, reasoning, general, long-context, vision).
//
// ponytail: keyword match on model id, not a real taxonomy. Family label is
// advisory only (surfaced in the response), routing never depends on it.
// Upgrade path: swap for a hand-maintained FAMILY_MAP table keyed by
// exact model id, or drive it off getCapabilitiesForModel().reasoning/vision.
const FAMILIES = [
  { key: "vision",    match: /(vision|image|multimodal|omni|gpt-4o|gpt-5o|gemini)/i },
  { key: "reasoning", match: /(deep[- ]?think|o[13]|\breason|thinking|thinker|fable)/i },
  { key: "coding",    match: /(code|codex|claudef|cursor|poolside|laguna|kimi|dev|swe)/i },
  { key: "longctx",   match: /(long|1m|million|context[- ]|longctx|nemotron)/i },
];

const DEFAULT_PROMPT = "Explain what a JavaScript closure is, in one short sentence.";

function detectFamily(id, name) {
  const text = `${id} ${name || ""}`;
  for (const f of FAMILIES) if (f.match.test(text)) return f.key;
  return "general";
}

function isFree(m) {
  if (m.caps?.isFree === true) return true;
  if (m.isFree === true) return true;
  return isFreeModel(m);
}

function normalizeFreeRow(alias, m) {
  const id = typeof m === "string" ? m : m?.id;
  if (!id) return null;
  if (!isFree({ id, free: m?.isFree })) return null;
  const name = typeof m === "string" ? m : (m.name || id);
  return {
    providerAlias: alias,
    id,
    name,
    type: "llm",
    family: detectFamily(id, name),
    caps: typeof m === "string" ? undefined : m,
    full: `${alias}/${id}`,
  };
}

/**
 * Collect every free model we know about, normalized to { providerAlias, id,
 * name, type, family, caps, full }. De-dups on providerAlias|id.
 * @returns {Promise<Array>}
 */
export async function collectFreeModels() {
  const out = new Map();

  const push = (row) => {
    if (!row) return;
    const key = `${row.providerAlias}|${row.id}`;
    if (out.has(key)) return;
    out.set(key, row);
  };

  // 1. Custom models with an explicit free flag (omniSync/providerSync rows).
  const custom = await getCustomModels();
  for (const m of custom || []) {
    if (!isFree(m)) continue;
    push({
      providerAlias: m.providerAlias,
      id: m.id,
      name: m.name || m.id,
      type: m.type || m.kind || "llm",
      family: detectFamily(m.id, m.name),
      caps: m.caps,
      full: `${m.providerAlias}/${m.id}`,
    });
  }

  // 2. Static registry free rows (openrouter/cursor/... :free ids).
  for (const [alias, models] of Object.entries(PROVIDER_MODELS || {})) {
    for (const m of models || []) push(normalizeFreeRow(alias, m));
  }

  // 3. Live free-fetcher catalogs (same pipeline as the suggested-models
  //    panel and providerSync): pull the providers' own public /models
  //    endpoints, run them through the shared free-only FILTERS. No upserts
  //    here — the rows only feed this run's candidate list.
  const activeProviderIds = new Set(
    (await getProviderConnections() || []).map((c) => c.provider)
  );
  for (const entry of REGISTRY) {
    const filterType = entry.modelsFetcher?.type;
    if (!filterType || !FILTERS[filterType] || entry.hidden) continue;
    // noAuth catalogs need no connection; others only matter when the user
    // has at least one live connection for that provider (otherwise the
    // imported custom models can never be routed).
    if (!entry.noAuth && !activeProviderIds.has(entry.id)) continue;
    let rows;
    try {
      const res = await fetch(entry.modelsFetcher.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const raw = json.data ?? json.models ?? json;
      rows = Array.isArray(raw) ? raw : [];
    } catch {
      continue;
    }
    const alias = entry.alias || entry.id;
    const filter = FILTERS[filterType];
    for (const m of filter(rows) || []) push(normalizeFreeRow(alias, m));
  }

  return [...out.values()];
}

/**
 * Ping every candidate, keep only the ones that answer.
 * Pings run in a capped parallel pool (default 8): a dead provider would
 * otherwise stall the whole curation sequentially.
 * @returns {Promise<{ok: Array, failed: Array, baseUrl: string}>}
 */
export async function verifyCandidates(candidates, baseUrl) {
  const ok = [];
  const failed = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(PING_CONCURRENCY, candidates.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= candidates.length) return;
        const c = candidates[i];
        const kind = c.type || "llm";
        // Image / tts / stt families aren't meaningful for a chat combo.
        if (kind !== "llm") { failed.push({ ...c, error: "non-llm kind skipped" }); continue; }
        try {
          const res = await pingModelByKind(c.full, "llm", baseUrl);
          if (res.ok) ok.push({ ...c, latencyMs: res.latencyMs });
          else failed.push({ ...c, error: res.error || `HTTP ${res.status}` });
        } catch (err) {
          failed.push({ ...c, error: err?.message || String(err) });
        }
      }
    }
  );
  await Promise.all(workers);
  return { ok, failed, baseUrl };
}

/**
 * Race a benchmark prompt across the verified survivors (parallel, capped),
 * and pick the fastest answerer per family.
 * @param {Array} verified - candidates that passed the ping
 * @param {{ prompt?: string, concurrency?: number, perCallTimeoutMs?: number, baseUrl?: string }} [opts]
 * @returns {Promise<{ winners: Array, perFamily: Object, raced: Array, baseUrl: string }>}
 */
export async function benchmarkRace(verified, opts = {}) {
  const prompt = opts.prompt || DEFAULT_PROMPT;
  const concurrency = Math.max(1, opts.concurrency || 4);
  const perCallTimeoutMs = opts.perCallTimeoutMs || 20000;
  const baseUrl = opts.baseUrl || `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

  const raced = [];
  let cursor = 0;
  const workerCount = Math.min(concurrency, verified.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= verified.length) return;
      const c = verified[i];
      const start = Date.now();
      let ok = false, content = "", error = null;
      try {
        const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: c.full,
            stream: false,
            max_tokens: 512,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(perCallTimeoutMs),
        });
        const raw = await res.text();
        const parsed = res.ok ? JSON.parse(raw || "null") : null;
        content = String(parsed?.choices?.[0]?.message?.content || "").trim();
        if (res.ok && content) ok = true;
        else error = res.ok ? "empty answer" : `HTTP ${res.status}: ${String((parsed?.error?.message) || raw).slice(0, 200)}`;
      } catch (err) {
        error = err?.name === "TimeoutError" ? "timeout" : (err?.message || String(err));
      }
      raced.push({ ...c, ok, content: content.slice(0, 300), latencyMs: Date.now() - start, error });
    }
  });
  await Promise.all(workers);

  // Pick the fastest usable winner per family.
  const perFamily = {};
  for (const r of raced) {
    if (!r.ok) continue;
    const cur = perFamily[r.family];
    if (!cur || r.latencyMs < cur.latencyMs) perFamily[r.family] = r;
  }
  const winners = Object.values(perFamily);

  return { winners, perFamily, raced, baseUrl };
}

/**
 * High-level: run the full curation pipeline and upsert the combo.
 * @param {{ comboName?: string, prompt?: string, concurrency?: number, perCallTimeoutMs?: number, baseUrl?: string, skipBenchmark?: boolean }} [opts]
 * @returns {Promise<{ comboName: string, models: string[], winners: Array, skipped: Array, error: string|null }>}
 */
export async function curateFreeCombo(opts = {}) {
  const comboName = opts.comboName || "FreeTier";
  const baseUrl = opts.baseUrl || `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

  const all = await collectFreeModels();
  if (all.length === 0) {
    return { comboName, models: [], winners: [], skipped: [], error: "no free models found" };
  }

  const { ok, failed } = await verifyCandidates(all, baseUrl);
  if (ok.length === 0) {
    return { comboName, models: [], winners: [], skipped: failed, error: "no free models usable with current accounts" };
  }

  let winners;
  if (opts.skipBenchmark) {
    // Keep the fastest pinged survivor per family without racing a real prompt.
    const perFamily = {};
    for (const c of ok) {
      const cur = perFamily[c.family];
      if (!cur || c.latencyMs < cur.latencyMs) perFamily[c.family] = c;
    }
    winners = Object.values(perFamily);
  } else {
    const { winners: raced } = await benchmarkRace(ok, { ...opts, baseUrl });
    winners = raced;
  }

  const models = winners.map((w) => w.full);

  // Upsert via the combo repo so the rotation cache is invalidated the same
  // way the dashboard does it.
  const { updateCombo, getComboByName, createCombo } = await import("@/lib/localDb");
  const { resetComboRotation } = await import("open-sse/services/combo.js");
  const existing = await getComboByName(comboName);
  if (existing) {
    await updateCombo(existing.id, { name: comboName, kind: existing.kind, models });
    resetComboRotation(comboName);
  } else {
    await createCombo({ name: comboName, models, kind: null });
  }

  return { comboName, models, winners, skipped: failed, error: null };
}

/**
 * Detect rate-limit / credit / quota failures from a ping result.
 * True when the HTTP status is 402 or 429, or the error text (case-insensitive)
 * mentions rate limit, credit, quota, or insufficient balance.
 */
function isRateLimitOrQuotaFailure(res) {
  if (!res || res.ok) return false;
  if (res.status === 402 || res.status === 429) return true;
  const msg = String(res.error || "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("rate-limit") ||
    msg.includes("credit") ||
    msg.includes("quota") ||
    msg.includes("insufficient")
  );
}

/**
 * High-level: "one free model per provider" curation.
 * Collects all free models, pings them in a capped parallel pool (concurrency 8,
 * 15s timeout each — matching pingModelByKind's built-in signal), skips
 * rate-limit / credit / quota failures, and keeps exactly the lowest-latency
 * survivor per provider.
 * @param {{ comboName?: string, baseUrl?: string }} [opts]
 * @returns {Promise<{ comboName: string, models: string[], winners: Array, skipped: Array, error: string|null }>}
 */
export async function curateFreeComboPerProvider(opts = {}) {
  const comboName = opts.comboName || "unify";
  const baseUrl = opts.baseUrl || `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

  const all = await collectFreeModels();
  if (all.length === 0) {
    return { comboName, models: [], winners: [], skipped: [], error: "no free models found" };
  }

  // Group candidates by providerAlias; non-llm kinds don't fit a chat combo.
  const byProvider = {};
  for (const c of all) {
    if ((c.type || "llm") !== "llm") continue;
    (byProvider[c.providerAlias] ||= []).push(c);
  }

  const queue = [];
  for (const cands of Object.values(byProvider)) {
    for (const c of cands) queue.push(c);
  }

  // Capped parallel pool: ping every candidate, keep pongs with latency.
  const results = new Map(); // full -> { candidate, res }
  if (queue.length > 0) {
    let cursor = 0;
    const poolSize = Math.min(PING_CONCURRENCY, queue.length);
    await new Promise((resolve) => {
      const workers = Array.from({ length: poolSize }, async () => {
        for (;;) {
          const i = cursor++;
          if (i >= queue.length) return;
          const c = queue[i];
          let res;
          try {
            res = await pingModelByKind(c.full, "llm", baseUrl);
          } catch (err) {
            res = { ok: false, error: err?.message || String(err), latencyMs: null, status: 0 };
          }
          results.set(c.full, { candidate: c, res });
        }
      });
      Promise.all(workers).then(resolve);
    });
  }

  const survivors = [];
  const skipped = [];
  for (const { candidate: c, res } of results.values()) {
    if (!res.ok) {
      if (isRateLimitOrQuotaFailure(res)) {
        skipped.push({
          ...c,
          reason: res.status === 402 || res.status === 429
            ? `HTTP ${res.status} rate-limit/quota`
            : "rate-limit/credit/quota error",
          error: res.error,
        });
      } else {
        skipped.push({ ...c, reason: "ping failed", error: res.error });
      }
      continue;
    }
    survivors.push({ ...c, latencyMs: res.latencyMs });
  }

  // Lowest-latency survivor per provider. When a provider has zero survivors
  // (e.g. every ping 401'd on a key-gate), fall back to that provider's first
  // free llm candidate so the combo always holds exactly 1 free model per
  // provider and is never empty as long as at least one free model exists.
  const perProvider = {};
  for (const s of survivors) {
    const cur = perProvider[s.providerAlias];
    if (!cur || s.latencyMs < cur.latencyMs) perProvider[s.providerAlias] = s;
  }
  for (const [alias, cands] of Object.entries(byProvider)) {
    if (!perProvider[alias] && cands.length > 0) {
      perProvider[alias] = { ...cands[0], latencyMs: null, fallback: true };
    }
  }
  const winners = Object.values(perProvider).sort((a, b) => a.providerAlias.localeCompare(b.providerAlias));
  const models = winners.map((w) => w.full);

  // Upsert via the combo repo so the rotation cache is invalidated the same
  // way the dashboard does it.
  const { updateCombo, getComboByName, createCombo } = await import("@/lib/localDb");
  const { resetComboRotation } = await import("open-sse/services/combo.js");
  const existing = await getComboByName(comboName);
  if (existing) {
    await updateCombo(existing.id, { name: comboName, kind: existing.kind, models });
    resetComboRotation(comboName);
  } else {
    await createCombo({ name: comboName, models, kind: null });
  }

  return { comboName, models, winners, skipped, error: null };
}
