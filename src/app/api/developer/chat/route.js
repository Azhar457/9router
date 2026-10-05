import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Dashboard-authenticated relay for the Developer page.
 * Injects a valid router API key server-side so hub-origin calls work even
 * when requireApiKey=true. The key never leaves the server.
 * Guard: /api/* is deny-by-default in dashboardGuard (JWT required).
 */
export async function POST(request) {
  await ensureInitialized();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  // A/B mode flags: strip before forwarding.
  //   _noSteering  → header x-9router-token-saver: off (router-side token
  //     savers off so arm differences reflect only the client-supplied style).
  //   _noPayload   → header x-9router-inject: off (the global-inject
  //     register + jailbreak payload is NOT appended to this arm — used by
  //     the A/B "plain" control arm so it ships clean).
  //   _injectPayload → body.__dashboardPayloadOverride, consumed by
  //     src/sse/handlers/chat.js which overrides injectionGodmodeCustom
  //     for THIS request only — the A/B "test" arm carries the jailbreak
  //     payload without touching the global settings.
  let noSteering = false;
  let noPayload = false;
  let payloadOverride = "";
  if (body && typeof body === "object") {
    if (body._noSteering) {
      noSteering = true;
      delete body._noSteering;
    }
    if (body._noPayload) {
      noPayload = true;
      delete body._noPayload;
    }
    if (typeof body._injectPayload === "string") {
      payloadOverride = body._injectPayload;
      delete body._injectPayload;
    }
  }

  const keys = await getApiKeys().catch(() => []);
  const activeKey = Array.isArray(keys) ? keys.find((k) => k?.isActive && k.key) : null;
  if (!activeKey) {
    return Response.json(
      { error: { message: "No active API key configured — create one in Endpoint settings" } },
      { status: 503 }
    );
  }

  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${activeKey.key}`);
  if (noSteering) headers.set("x-9router-token-saver", "off");
  if (noPayload) headers.set("x-9router-inject", "off");

  if (payloadOverride) {
    body.__dashboardPayloadOverride = payloadOverride;
  }

  const url = new URL("/api/v1/chat/completions", request.url);
  const forwarded = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return handleChat(forwarded);
}
