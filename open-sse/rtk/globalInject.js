// Global Injection — unified injector that appends BOTH the register prompt
// (Plinian-style, with optional identity override) AND the selected G0DM0D3
// jailbreak payload into the system message of the final request body, just
// before dispatch. One toggle = both ride along. Order matters: identity →
// register → payload, so the jailbreak text sits closest to the user query.
//
// Same fail-open contract as caveman.js / ponytail.js / plinian.js /
// godmode.js: any error leaves the body untouched.
//
// Model-aware: when a model string is provided and the level is not pinned,
// pickGodmodeVariant picks the best-fit payload — including the adaptive
// thinking payload for modern Claude Fable 5.1 / Opus 5 / GPT-6 / Grok 4.5+
// models that no longer fall for the classic jailbreak template shapes.

import { injectPlinian } from "./plinian.js";
import { injectGodmode } from "./godmode.js";
import { injectSystemPrompt } from "./systemInject.js";

export function injectGlobal(body, format, opts = {}) {
  const {
    enabled = true,
    registerLevel = "standard",
    registerCustom = "",
    identity = "",
    godmodeLevel = "classic",
    godmodeCustom = "",
    model = "",
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
    // 2. Jailbreak payload — selected or auto-picked per model
    if (godmodeLevel) injectGodmode(body, format, godmodeLevel, godmodeCustom, model);
  } catch (_) {
    // never break a proxied request because of steering
  }
}

export function isGlobalInjectionEnabled(opts = {}) {
  return !!opts?.enabled && !!opts?.registerLevel || !!opts?.godmodeLevel;
}
