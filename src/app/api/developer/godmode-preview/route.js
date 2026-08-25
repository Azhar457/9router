import { getGodmodePrompt } from "open-sse/rtk/godmodePayloads.js";

export const dynamic = "force-dynamic";

/**
 * Transparency endpoint for the GODMODE card: returns the EXACT system-prompt
 * text that injectGodmode would append for the selected variant, so the UI
 * can render a WYSIWYG preview (incl. Custom→Classic fallback).
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const level = String(body?.level || "classic");
  const custom = typeof body?.custom === "string" ? body.custom : "";
  const text = getGodmodePrompt(level, custom);

  return Response.json({ level, chars: text.length, text });
}
