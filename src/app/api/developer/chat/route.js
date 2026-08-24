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

  const url = new URL("/api/v1/chat/completions", request.url);
  const forwarded = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return handleChat(forwarded);
}
