// GODMODE injector: appends the selected G0DM0D3 payload variant into the
// system message of the final request body, just before dispatch — same
// mechanics as caveman.js / ponytail.js / plinian.js.
// Fail-open: any error leaves the body untouched.

import { injectSystemPrompt } from "./systemInject.js";
import { getGodmodePrompt, pickGodmodeVariant } from "./godmodePayloads.js";

export function injectGodmode(body, format, level = "classic", customText = "", model = "") {
  try {
    // "classic" is the default meaning "let me pick"; any other level is a
    // user-pinned explicit variant. When a model is provided, resolve to the
    // best-fit variant — including the adaptive-thinking payload for modern
    // Fable/Opus-5/GPT-6/Grok-4.5+ models that no longer fall for classic
    // jailbreak structure.
    const autoPicked = !level || level === "classic";
    const effectiveLevel = autoPicked && model ? pickGodmodeVariant(model) : (level || "classic");
    injectSystemPrompt(body, format, getGodmodePrompt(effectiveLevel, customText));
  } catch (e) {
    // never break a proxied request because of steering
  }
}
