// Plinian injector: appends an optional identity claim + a register instruction
// into the system message of the final request body, just before dispatch —
// same mechanics as caveman.js / ponytail.js. Fail-open: any error leaves the
// body untouched.

import { injectSystemPrompt } from "./systemInject.js";
import { getPlinianPrompt } from "./plinianPrompts.js";

export function injectPlinian(body, format, level, identityText = "") {
  try {
    const identity = String(identityText || "").trim();
    const prompt = identity
      ? `${identity}\n\n${getPlinianPrompt(level)}`
      : getPlinianPrompt(level);
    injectSystemPrompt(body, format, prompt);
  } catch (e) {
    // never break a proxied request because of steering
  }
}
