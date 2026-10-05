// Redaction helpers for the transparency console.
//
// Everything the UI renders about an outbound request MUST pass through
// redactForDisplay() — transparency captures contain the actual request
// bodies, so without redaction the transparency feature itself would become
// a credential leak (API keys, OAuth tokens, base64 image payloads).
//
// Rules (defense in depth):
//   1. Well-known secret shapes in any string (sk-…, JWT, Bearer, GitHub /
//      Google / Slack tokens) → replaced with [REDACTED_*].
//   2. Sensitive object keys (apiKey, accessToken, password, …) → [REDACTED]
//      regardless of the value's shape.
//   3. Data-URL images and long base64 blobs → "[image …N KB]" /
//      "[base64 …N KB]" so captures stay small and readable.
//
// This module is intentionally dependency-free and synchronous so both the
// server (capture store) and the client (Developer console) can use it.

const SECRET_PATTERNS = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_ANTHROPIC_KEY]"],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[REDACTED_JWT]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_KEY]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bsk_[A-Za-z0-9]{20,}\b/g, "[REDACTED_KEY]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
];

const SENSITIVE_KEY_RE = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|authorization|proxy[-_]?authorization|session[-_]?token|x-api-key)$/i;

const DATA_URL_RE = /^data:[^;,]+;base64,/i;
const LONG_BASE64_RE = /^[A-Za-z0-9+/]{512,}={0,2}$/;

const KB = 1024;

function kb(len) {
  const v = len / KB;
  return v >= 100 ? `${Math.round(v)}KB` : `${v.toFixed(1)}KB`;
}

export function redactString(text) {
  let out = String(text);
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/** Redact a single string value; binary/base64 blobs become placeholders. */
function redactScalar(value) {
  if (typeof value !== "string") return value;
  if (DATA_URL_RE.test(value)) {
    const b64 = value.slice(value.indexOf(",") + 1);
    return `[image base64 ${kb(value.length)} removed]`;
  }
  if (LONG_BASE64_RE.test(value)) {
    return `[base64 ${kb(value.length)} removed]`;
  }
  return redactString(value);
}

/** Deep-walk any JSON value and redact secrets. Returns a new structure. */
export function redactValue(value, keyName = "") {
  if (value == null) return value;
  if (SENSITIVE_KEY_RE.test(String(keyName))) return "[REDACTED]";
  if (typeof value === "string") return redactScalar(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keyName));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}

/** Redact a full object (request body, headers, …) for display/storage. */
export function redactForDisplay(obj) {
  return redactValue(obj);
}

/** Redact a headers bag (lower-case or mixed keys). */
export function redactHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /^(?:authorization|proxy-authorization|x-api-key|api-key|cookie|x-goog-api-key|anthropic-api-key|x-auth-token)$/i.test(k)
      ? "[REDACTED]"
      : redactScalar(v);
  }
  return out;
}

/** First maxChars of a string + truncation notice (post-redaction). */
export function previewText(text, maxChars = 1200) {
  const s = typeof text === "string" ? text : "";
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}… (+${(s.length - maxChars).toLocaleString()} chars)`;
}
