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
// Carrier column (optional, off by default): a second "carrier" payload
// (dark-RP v12, RFC framework, or custom text) wraps the main payload —
// auto-spliced into the [YOUR JAILBREAK HERE] slot, or appended when the
// carrier has no slot. Wrapping is NOT always more effective; the column
// is opt-in precisely for that reason. Some payloads (VEIL) already embed
// a carrier frame internally — see payloadCatalog.js BUILTIN_CARRIER_IDS.
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
    carrierEnabled = false,
    carrierLevel = "",
    carrierCustom = "",
    skillRouterCustom = "",
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
    //    Carrier (optional, off by default): when carrierEnabled + a carrier
    //    is chosen, the main payload is auto-wrapped into the carrier's slot.
    //    carrierCustom overrides the carrier text (user-editable).
    if (godmodeLevel) {
      const mainText = getGodmodePrompt(godmodeLevel, godmodeCustom);
      const carrierOn = carrierEnabled && (carrierCustom.trim() || carrierLevel);
      if (carrierOn) {
        const carrierText = carrierCustom.trim() || getExternalPayload(carrierLevel) || "";
        const composed = spliceCarrier(carrierText, mainText);
        injectSystemPrompt(body, format, composed);
        opts.onCarrierSplice?.({
          carrier: carrierLevel || "custom",
          chars: composed.length,
          spliced: carrierText.includes(CARRIER_SLOT),
        });
      } else {
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
