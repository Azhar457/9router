// Go RTK sidecar client. RTK_BACKEND=go switches chatCore to the Go
// implementation (POST /-/rtk/compress on the gateway); anything else —
// including network failure — falls back to the JS path, fail-open.
import { compressMessages } from "./index.js";

const GO_ENABLED = process.env.RTK_BACKEND === "go";
const SIDECAR_URL = (process.env.RTK_SIDECAR_URL || "http://127.0.0.1:20127").replace(/\/$/, "");

// Same contract as compressMessages: mutates `body` in place, returns stats
// or null when disabled / nothing matched / failed.
export async function compressMessagesAuto(body, enabled) {
  if (!GO_ENABLED) return compressMessages(body, enabled);
  if (!enabled || !body) return null;
  try {
    const res = await fetch(`${SIDECAR_URL}/-/rtk/compress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return compressMessages(body, enabled);
    const data = await res.json();
    // stats == null means "no container matched" or internal error — the JS
    // path is cheap in both cases and is the fail-open authority.
    if (!data || data.stats == null) return compressMessages(body, enabled);
    // Copy Go's output back into the caller's object (JS contract mutates in place).
    const parsed = typeof data.body === "string" ? JSON.parse(data.body) : data.body;
    for (const k of Object.keys(body)) delete body[k];
    Object.assign(body, parsed);
    return data.stats;
  } catch {
    return compressMessages(body, enabled);
  }
}
