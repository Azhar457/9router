// Outbound capture handler — bridges the chat pipeline (open-sse, which must
// stay standalone) to the app-side transparency store.
//
// chatCore.js calls the returned handler once per request, AFTER every
// saver/injector has reshaped the body and BEFORE the executor dispatches
// it upstream. The handler is fire-and-forget: it never throws and never
// blocks the proxied request.
//
// Everything recorded passes through shared/lib/redact.js — captures are
// display-safe by construction (API keys, OAuth tokens and base64 image
// payloads are stripped before they ever reach disk).

import { recordCapture } from "@/lib/transparency/captureStore";
import { redactForDisplay, redactString, previewText } from "@/shared/lib/redact";

const SYSTEM_PREVIEW_CHARS = 1200;
const BEFORE_PREVIEW_CHARS = 400;

/** Pull the system message(s) out of the body, format-aware. */
function extractSystem(body, format) {
  if (!body || typeof body !== "object") return "";
  if (Array.isArray(body.messages)) {
    return body.messages
      .filter((m) => m?.role === "system" || m?.role === "developer")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n\n===\n\n");
  }
  if (format === "claude" || body.system) {
    if (typeof body.system === "string") return body.system;
    if (Array.isArray(body.system)) {
      return body.system.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n\n");
    }
  }
  if (Array.isArray(body.system_instruction?.parts)) {
    return body.system_instruction.parts.map((p) => p?.text || "").join("\n\n");
  }
  if (Array.isArray(body.contents)) {
    return body.contents
      .filter((c) => c?.role === "system" || c?.role === "user" && c === body.contents[0])
      .map((c) => JSON.stringify(c?.parts || c))
      .join("\n\n");
  }
  return "";
}

function safeBytes(value) {
  try {
    return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? {}), "utf8");
  } catch {
    return 0;
  }
}

/**
 * Build the capture handler. `enabled` comes from settings
 * (transparencyCaptureEnabled), `saveFullBody` opts into storing the full
 * redacted body (transparencySaveFullBody) — default off keeps captures small.
 */
export function makeOutboundCaptureHandler({ enabled = true, saveFullBody = false } = {}) {
  if (!enabled) return null;
  return function onOutboundCapture(evt) {
    try {
      const {
        provider,
        model,
        format,
        body,
        sourceBody,
        tags = [],
        injectionActive = false,
        connectionId = null,
      } = evt || {};

      const finalSystem = extractSystem(body, format);
      const beforeSystem = extractSystem(sourceBody, null);

      const capture = {
        provider,
        model,
        format,
        connectionId,
        injectionActive,
        tags: Array.isArray(tags) ? tags.map((t) => redactString(String(t))) : [],
        bytes: safeBytes(body),
        sourceBytes: safeBytes(sourceBody),
        messageCount:
          (Array.isArray(body?.messages) && body.messages.length) ||
          (Array.isArray(body?.input) && body.input.length) ||
          (Array.isArray(body?.contents) && body.contents.length) ||
          0,
        systemPreview: previewText(redactString(finalSystem), SYSTEM_PREVIEW_CHARS),
        systemBeforePreview: previewText(redactString(beforeSystem), BEFORE_PREVIEW_CHARS),
      };

      if (saveFullBody) {
        capture.redactedBody = redactForDisplay(body);
      }

      recordCapture(capture);
    } catch {
      // Never let transparency break proxying.
    }
  };
}
