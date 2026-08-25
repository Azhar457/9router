// GODMODE injector: appends the selected G0DM0D3 payload variant into the
// system message of the final request body, just before dispatch — same
// mechanics as caveman.js / ponytail.js / plinian.js.
// Fail-open: any error leaves the body untouched.

import { injectSystemPrompt } from "./systemInject.js";
import { getGodmodePrompt } from "./godmodePayloads.js";

export function injectGodmode(body, format, level = "classic") {
  try {
    injectSystemPrompt(body, format, getGodmodePrompt(level));
  } catch (e) {
    // never break a proxied request because of steering
  }
}
