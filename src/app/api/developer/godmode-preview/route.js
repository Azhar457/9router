import { getGodmodePrompt, pickGodmodeVariant } from "open-sse/rtk/godmodePayloads.js";

export const dynamic = "force-dynamic";

/**
 * Transparency endpoint for the Global Injection card: returns the EXACT
 * system-prompt text that injectGodmode would append for the selected
 * variant, so the UI can render a WYSIWYG preview.
 *
 * When level is "classic" (the default / "auto-pick" sentinel) and a model
 * string is provided, pickGodmodeVariant resolves to the best-fit payload —
 * including the adaptive-thinking payload for modern Fable / Opus-5 / GPT-6
 * / Grok-4.5+ models that no longer fall for the classic jailbreak shapes.
 * Pinning a specific level (grok420, geminiReset, adaptive, VEIL, custom, …)
 * overrides the auto-pick.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawLevel = String(body?.level || "classic");
  const custom = typeof body?.custom === "string" ? body.custom : "";
  const model = typeof body?.model === "string" ? body.model : "";

  // "classic" is the "let me pick" sentinel — resolve per model when one is
  // provided; otherwise fall back to the canonical G0DM0D3 + depth directive.
  const effectiveLevel =
    rawLevel === "classic" && model ? pickGodmodeVariant(model) : rawLevel;

  const text = getGodmodePrompt(effectiveLevel, custom);

  return Response.json({
    level: effectiveLevel,
    autoPicked: rawLevel === "classic" && !!model && effectiveLevel !== "classic",
    chars: text.length,
    text,
  });
}
