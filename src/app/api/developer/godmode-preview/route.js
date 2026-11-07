import { getGodmodePrompt } from "open-sse/payload/godmodePayloads.js";
import { estimateTokens, formatTok } from "open-sse/rtk/tokenEstimate.js";

export const dynamic = "force-dynamic";

/**
 * Transparency endpoint for the Global Injection card: returns the EXACT
 * system-prompt text that injectGodmode would append for the selected
 * variant, so the UI can render a WYSIWYG preview.
 *
 * The level is what ships, verbatim — there is no per-model auto-selection.
 * "classic" is the classic G0DM0D3 + depth-directive payload, not a sentinel
 * that resolves to something else based on the upstream model.
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

  return Response.json({
    level,
    chars: text.length,
    estTokens: estimateTokens(text),
    estLabel: `≈${formatTok(estimateTokens(text))} tok`,
    text,
  });
}
