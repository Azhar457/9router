// Plinian injector: appends a Plinian register instruction into the system
// message of the final request body, just before dispatch — same mechanics as
// caveman.js / ponytail.js. Fail-open: any error leaves the body untouched.

import { injectSystemPrompt } from "./systemInject.js";
import { getPlinianPrompt } from "./plinianPrompts.js";

export function injectPlinian(body, format, level) {
  try {
    injectSystemPrompt(body, format, getPlinianPrompt(level));
  } catch (e) {
    // never break a proxied request because of steering
  }
}
