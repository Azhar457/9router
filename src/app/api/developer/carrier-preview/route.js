import { getGodmodePrompt, pickGodmodeVariant } from "open-sse/rtk/godmodePayloads.js";
import { getExternalPayload } from "open-sse/rtk/jailbreakPayloads.js";
import { CARRIER_SLOT, spliceCarrier } from "open-sse/rtk/payloadCatalog.js";
import { estimateTokens, formatTok } from "open-sse/rtk/tokenEstimate.js";

export const dynamic = "force-dynamic";

/**
 * Transparency endpoint for the carrier column of the Global Injection card:
 * returns the EXACT composed text that injectGlobal would append when the
 * optional carrier is enabled — carrier wrapping the main payload.
 *
 * Body: { level, custom, carrierLevel, carrierCustom, model }
 *   level         — main payload variant ("classic" = auto-pick sentinel)
 *   carrierLevel  — carrier payload id (registry "f:*" id or builtin)
 *   carrierCustom — user-edited carrier text; overrides carrierLevel when set
 *
 * The carrier auto-wraps: main payload is spliced into [YOUR JAILBREAK HERE]
 * when the carrier has the slot, appended after it otherwise (nothing lost).
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
  const carrierLevel = typeof body?.carrierLevel === "string" ? body.carrierLevel : "";
  const carrierCustom = typeof body?.carrierCustom === "string" ? body.carrierCustom : "";

  const effectiveLevel =
    rawLevel === "classic" && model ? pickGodmodeVariant(model) : rawLevel;
  const mainText = getGodmodePrompt(effectiveLevel, custom);

  const carrierOn = !!(carrierCustom.trim() || carrierLevel);
  const carrierText = carrierOn ? (carrierCustom.trim() || getExternalPayload(carrierLevel) || "") : "";
  const composed = carrierOn ? spliceCarrier(carrierText, mainText) : mainText;

  return Response.json({
    level: effectiveLevel,
    autoPicked: rawLevel === "classic" && !!model && effectiveLevel !== "classic",
    carrier: carrierOn ? carrierLevel || "custom" : "",
    carrierChars: carrierText.length,
    spliced: !!(carrierText && carrierText.includes(CARRIER_SLOT)),
    chars: composed.length,
    estTokens: estimateTokens(composed),
    estLabel: `≈${formatTok(estimateTokens(composed))} tok`,
    text: composed,
  });
}
