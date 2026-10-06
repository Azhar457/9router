// Global Injection — unified injector that appends the register prompt
// (Plinian-style, with optional identity override), the selected G0DM0D3
// jailbreak payload, and optionally the SKILL-ROUTER-STRIX index (from the
// Penetration tab's separate injectionSkillRouterCustom slot) into the
// system message of the final request body, just before dispatch. One
// master toggle = all ride along.
//
// Injection order (identity → register → payload → skill-router) is chosen
// so the jailbreak text sits closest to the user query, and the SKILL-ROUTER
// index — a compact catalog + fetch protocol, never a jailbreak — rides
// after it as its own clearly-labeled block. The two payload slots
// (injectionGodmodeCustom and injectionSkillRouterCustom) are fully
// independent: the Penetration tab writes to the skill-router slot only;
// the Jailbreaks/Payload tab writes to the godmode slot only. They can coexist.
//
// Same fail-open contract as caveman.js / ponytail.js / plinian.js /
// godmode.js: any error leaves the body untouched.
//
// Carrier warp (v0.6.0 rework): the separate "carrier column" was REMOVED.
// A carrier warp frame (VEIL / Dark RP / RFC 454) now lives inside the
// Persona text (injectionIdentity) — the Persona dropdown's "📦 Carrier warp"
// preset auto-fills the persona textarea with the carrier frame. At
// injection time, if the persona text contains the [YOUR JAILBREAK HERE]
// slot marker, the main payload auto-splices into it; otherwise the payload
// appends after the persona frame. This means the persona text IS the
// carrier — no separate injectionCarrier* keys needed at runtime. Legacy
// injectionCarrier* keys are auto-migrated to injectionIdentity on first
// load (one-time, in the UI).
//
// Model-aware: when a model string is provided and the level is not pinned,
// pickGodmodeVariant picks the best-fit payload — including the adaptive
// thinking payload for modern Claude Fable 5.1 / Opus 5 / GPT-6 / Grok 4.5+
// models that no longer fall for the classic jailbreak template shapes.

import { injectPlinian } from "./plinian.js";
import { injectGodmode } from "./godmode.js";
import { injectSystemPrompt } from "./systemInject.js";
import { getGodmodePrompt } from "./godmodePayloads.js";
import { CARRIER_SLOT, spliceCarrier, resolvePayload } from "./payloadCatalog.js";
import { getExternalPayload } from "./jailbreakPayloads.js";

export function injectGlobal(body, format, opts = {}) {
  const {
    enabled = true,
    registerLevel = "standard",
    registerCustom = "",
    identity = "",
    godmodeLevel = "classic",
    godmodeCustom = "",
    model = "",
    skillRouterCustom = "",
    // Legacy (one-time migration only, not read at runtime):
    // carrierEnabled / carrierLevel / carrierCustom are retained in the
    // destructure for backward compat with older callers, but the
    // runtime carrier logic now reads the persona text (identity) instead.
    carrierEnabled = false,
    carrierLevel = "",
    carrierCustom = "",
  } = opts;

  if (!enabled || !body) return;
  try {
    // 1. Register (Plinian) + identity — shaping only, never changes policy.
    // A custom register text (from the UI editor) overrides the preset level
    // entirely; an empty registerCustom means "use the selected preset level".
    const customReg = String(registerCustom || "").trim();
    if (customReg) {
      const prompt = [identity, customReg].filter(Boolean).join("\n\n");
      if (prompt) injectSystemPrompt(body, format, prompt);
    } else if (registerLevel) {
      injectPlinian(body, format, registerLevel, identity);
    }
    // 2. Jailbreak payload — selected or auto-picked per model.
    //
    // Carrier warp (v0.6.0 rework): the persona text (identity) may contain
    // a carrier frame with the [YOUR JAILBREAK HERE] slot marker. When it
    // does, the main payload auto-splices into the slot; when the persona
    // has no slot, the payload appends after the persona frame (nothing lost).
    // This replaces the old injectionCarrier* column entirely — the persona
    // textarea is now the single source of truth for carrier text.
    if (godmodeLevel) {
      const mainText = getGodmodePrompt(godmodeLevel, godmodeCustom);
      const identityTrimmed = String(identity || "").trim();
      // Carrier warp detection: the persona text carries the slot marker.
      const carrierWarp = identityTrimmed.includes(CARRIER_SLOT);
      // Legacy carrier column: still honored for one migration window so
      // requests in-flight during the upgrade keep working (the UI migrates
      // legacy keys to the persona textarea on mount; after that this branch
      // is dead code and can be removed in a future major).
      const legacyCarrierOn =
        carrierEnabled &&
        !carrierWarp &&
        (String(carrierCustom || "").trim() || carrierLevel);
      if (carrierWarp) {
        // Persona IS the carrier — splice the main payload into the slot.
        const composed = spliceCarrier(identityTrimmed, mainText);
        injectSystemPrompt(body, format, composed);
        opts.onCarrierSplice?.({
          carrier: "persona",
          chars: composed.length,
          spliced: true,
        });
      } else if (legacyCarrierOn) {
        // Legacy carrier column (migration window only).
        const carrierText = String(carrierCustom || "").trim() || getExternalPayload(carrierLevel) || "";
        const composed = spliceCarrier(carrierText, mainText);
        injectSystemPrompt(body, format, composed);
        opts.onCarrierSplice?.({
          carrier: carrierLevel || "custom",
          chars: composed.length,
          spliced: carrierText.includes(CARRIER_SLOT),
        });
      } else {
        // No carrier warp — just the main payload.
        injectSystemPrompt(body, format, mainText);
      }
    }
    // 3. SKILL-ROUTER-STRIX index (Penetration tab, separate slot).
    //    Ships as its own clearly-labeled block after the jailbreak payload.
    //    Never mixed into the godmode text; fully independent. Empty = no block.
    const skillRouter = String(skillRouterCustom || "").trim();
    if (skillRouter) {
      injectSystemPrompt(body, format, skillRouter);
    }
  } catch (_) {
    // never break a proxied request because of steering
  }
}

export function isGlobalInjectionEnabled(opts = {}) {
  return !!opts?.enabled && (!!opts?.registerLevel || !!opts?.godmodeLevel || !!opts?.skillRouterCustom);
}
