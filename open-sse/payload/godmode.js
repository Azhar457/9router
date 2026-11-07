// GODMODE injector: appends the selected G0DM0D3 payload variant into the
// system message of the final request body, just before dispatch — same
// mechanics as caveman.js / ponytail.js / plinian.js.
// Fail-open: any error leaves the body untouched.

import { injectSystemPrompt } from "../rtk/systemInject.js";
import { getGodmodePrompt } from "./godmodePayloads.js";

export function injectGodmode(body, format, level = "classic", customText = "") {
  try {
    // The level is exactly what the user selected — "classic" means the
    // classic payload, not a sentinel for per-model routing. Nothing is picked
    // on the user's behalf.
    injectSystemPrompt(body, format, getGodmodePrompt(level || "classic", customText));
  } catch (e) {
    // never break a proxied request because of steering
  }
}
