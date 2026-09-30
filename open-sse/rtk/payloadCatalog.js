// Payload catalog — the metadata layer over the jailbreak payload registry.
//
// Analogy: in a data warehouse, a *catalog* is the metadata-driven index over
// many source tables. Airflow sorts/routes by catalog metadata, not by raw
// content. Here each payload row carries structured fields so the UI + router
// can sort/filter/score by metadata, not by re-reading the payload text.
//
// Fields:
//   id            — stable variant id ("f:bf:dark-roleplay-v12", "classic", …)
//   label         — human-facing name
//   cat           — category key (PAYLOAD_CATEGORIES): coding|pentest|creative|general|nsfw
//   source        — "builtin" | "file" (registry)
//   kind          — "payload" (self-contained) | "carrier" (has a [YOUR JAILBREAK HERE] slot)
//   sizeChars     — payload length; the token cost basis
//   modelFamilies — upstream model families it targets (auto-routing hints)
//   effectiveness — tier: "current" (works on 2025-2026 models) | "legacy" (known-weak baseline)
//   estTokens     — chars/4 estimate (matches open-sse/rtk/tokenEstimate.js)
//
// The catalog is assembled lazily from:
//   1. builtin variants (godmodePayloads.js) — inline, no file
//   2. file payloads (jailbreakPayloads.js registry)
// and enriched with carrier detection + effectiveness tier.
//
// Fail-open: any missing piece falls back to a neutral default — the catalog
// is a sorting aid, never a hard gate.

import { getExternalPayloads, getExternalPayload, PAYLOAD_CATEGORIES } from "./jailbreakPayloads.js";
import { GODMODE_LEVELS, getVariantCategory, BUILTIN_VARIANT_CATEGORIES, getGodmodePrompt } from "./godmodePayloads.js";

export const CARRIER_SLOT = "[YOUR JAILBREAK HERE]";

// Detect a carrier payload: text that contains the slot placeholder.
// (Some payloads use [YOUR JAILBREAK HERE]; be permissive.)
export function isCarrierPayload(text) {
  return typeof text === "string" && text.includes(CARRIER_SLOT);
}

// effectiveness tier map. "legacy" = known-weak on modern model families,
// kept for reference / control. "current" = actively used by MODEL_VARIANT_MAP.
const LEGACY_IDS = new Set([
  "f:bf:s-dan", // classic S-DAN — 2022 era, no longer lands on Claude 4+/GPT-5+/Grok 4.5+
]);
// Builtins that embed their own carrier-style system block (VEIL carries a
// full 1.5k-token identity+purge+persona frame that wraps anything it's
// spliced into). Surfaced in the UI so Maker knows "this one already
// wraps" — but the user can still add an explicit carrier on top.
const BUILTIN_CARRIER_IDS = new Set(["VEIL"]);

// model families each builtin targets (for routing hints; file payloads pull
// their family from the COLLECTIONS entry id when known).
const BUILTIN_FAMILIES = {
  classic: ["*"],
  grok420: ["grok"],
  geminiReset: ["gemini"],
  gptClassic: ["gpt", "openai"],
  claudeInversion: ["claude"],
  hermesFast: ["hermes"],
  adaptive: ["claude-fable", "claude-opus-5", "gpt-6", "grok-4.5"],
  VEIL: ["*"],
  custom: ["*"],
};

const CHARS_PER_TOKEN = 4; // matches open-sse/rtk/tokenEstimate.js EST_CHARS_PER_TOKEN
export function estTokensFromChars(chars) {
  return Math.max(1, Math.round(chars / CHARS_PER_TOKEN));
}

// Assemble the full catalog. Returns an array of rows, sorted by (kind,
// effectiveness desc, cat, sizeChars) so "carriers first, current-gen first,
// smallest first within a tier" is the default Airflow-style ranking.
export function buildPayloadCatalog() {
  const rows = [];

  // 1. builtin variants — real size from the payload text (cheap: static strings)
  for (const id of Object.values(GODMODE_LEVELS)) {
    if (id === GODMODE_LEVELS.CUSTOM || id === "adaptive") continue; // no fixed text
    const cat = getVariantCategory(id) || BUILTIN_VARIANT_CATEGORIES[id] || "general";
    const text = getGodmodePrompt(id, "") || "";
    const size = text.length;
    rows.push({
      id,
      label: id,
      cat,
      source: "builtin",
      kind: "payload",
      sizeChars: size,
      modelFamilies: BUILTIN_FAMILIES[id] || ["*"],
      effectiveness: "current",
      estTokens: estTokensFromChars(size),
      hasBuiltInCarrier: BUILTIN_CARRIER_IDS.has(id),
      // builtins rarely carry the slot marker; resolve live anyway
      isCarrier: isCarrierPayload(text),
    });
  }

  // 2. file payloads from the registry (carries real sizeChars)
  for (const { id, chars, cat } of getExternalPayloads()) {
    rows.push({
      id,
      label: id,
      cat: cat || "general",
      source: "file",
      kind: "payload",
      sizeChars: chars,
      modelFamilies: id.startsWith("f:ai:") ? [] : ["*"], // AI-Jailbreaks are model-specific
      effectiveness: LEGACY_IDS.has(id) ? "legacy" : "current",
      estTokens: estTokensFromChars(chars),
      // carrier flag resolved eagerly — getExternalPayload is a local map
      // lookup (loadRegistry() already read the files into memory at import).
      isCarrier: isCarrierPayload(getExternalPayload(id) || ""),
    });
  }

  return rows;
}

// Resolve a payload id to { text, kind } — kind is "carrier" when the text
// contains the slot. This is what the carrier-mechanism consumer uses.
export function resolvePayload(id, getText) {
  const text = getText ? getText(id) : null;
  const row = {
    id,
    text: text || "",
    kind: text ? (isCarrierPayload(text) ? "carrier" : "payload") : "payload",
    sizeChars: text ? text.length : 0,
    estTokens: estTokensFromChars(text ? text.length : 0),
  };
  return row;
}

// Compose a final system-prompt block from a carrier + inner payload:
// the inner payload is spliced into the [YOUR JAILBREAK HERE] slot. When the
// carrier has no slot, fall back to appending the payload after it.
export function spliceCarrier(carrierText, innerText) {
  const c = String(carrierText || "");
  const inner = String(innerText || "").trim();
  if (!c) return inner;
  if (c.includes(CARRIER_SLOT) && inner) {
    // Replace ALL occurrences — some carriers (dark-RP v12) also mention
    // the slot in a usage note. Leaving a bare "[YOUR JAILBREAK HERE]"
    // behind reads as an unfilled placeholder to the model.
    return c.split(CARRIER_SLOT).join(inner);
  }
  // no slot — append so nothing is lost (fail-open, never drop the payload)
  if (inner) return c + "\n\n" + inner;
  return c;
}

export { PAYLOAD_CATEGORIES };
