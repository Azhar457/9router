import { getExternalPayload } from "open-sse/rtk/jailbreakPayloads.js";
import { getGodmodePrompt } from "open-sse/rtk/godmodePayloads.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/developer/persona-preset?key=<id>
 *
 * Returns the full text of a carrier-warp persona template (VEIL / Dark RP /
 * RFC 454) resolved from the payload registry. This backs the Persona
 * dropdown's "Carrier" optgroup: applying a carrier template fetches the
 * real frame text so Maker can see + edit it in the Persona textarea.
 *
 * Resolution order:
 *   1. Builtin godmode level (e.g. "VEIL") → getGodmodePrompt
 *   2. File registry id (e.g. "f:bf:dark-roleplay-v12") → getExternalPayload
 *   3. Unknown → 404 (fail-open: UI keeps the placeholder text)
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key") || "";

  if (!key) {
    return Response.json({ error: "Missing ?key parameter" }, { status: 400 });
  }

  // 1. Builtin godmode level
  if (!key.startsWith("f:")) {
    const builtin = getGodmodePrompt(key, "");
    if (builtin) {
      return Response.json({
        key,
        text: builtin,
        source: "builtin",
        chars: builtin.length,
      });
    }
  }

  // 2. File registry
  const external = getExternalPayload(key);
  if (external) {
    return Response.json({
      key,
      text: external,
      source: "file",
      chars: external.length,
    });
  }

  // 3. Unknown — 404 so the UI keeps its placeholder text
  return Response.json(
    { error: `Unknown persona preset key: ${key}` },
    { status: 404 },
  );
}
