// Aggregate token-cost estimator for injected steering payloads.
//
// Why an estimate: tokenizers differ per model family (GPT-5 cl100k/
// o200k, Claude ~chars/3.5, Gemma-2a ~chars/2.5, K2/kimi in between),
// so a single number is only ever an estimate. The aggregate is the
// number that actually matters for cost — per-payload rows are shown
// with the same approximation, marked "est" everywhere they surface.
//
// Heuristic: ~4 chars/token aggregate, matching the pxpipe profitability
// gate (open-sse/rtk/pxpipe.js EST_CHARS_PER_TOKEN). Deliberately no
// tokenizer dependency — this runs on the hot request path.

const EST_CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  if (typeof text !== "string" || !text.length) return 0;
  return Math.max(1, Math.round(text.length / EST_CHARS_PER_TOKEN));
}

// Compact "1.2k" / "340" form for log lines and UI badges.
export function formatTok(n) {
  if (!n) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

// Aggregate estimate of the Global Injection payload set, independent of
// any request: register (plinian preset or custom) + identity + godmode
// variant. Same text selection as injectGlobal() in globalInject.js.
import { getPlinianPrompt } from "./plinianPrompts.js";
import { getGodmodePrompt, pickGodmodeVariant } from "./godmodePayloads.js";
import { getExternalPayload } from "./jailbreakPayloads.js";
import { CARRIER_SLOT, spliceCarrier } from "./payloadCatalog.js";

export function estimateGlobalInjection({
  registerLevel = "standard",
  registerCustom = "",
  identity = "",
  godmodeLevel = "classic",
  godmodeCustom = "",
  model = "",
  carrierEnabled = false,
  carrierLevel = "",
  carrierCustom = "",
} = {}) {
  const regText = registerCustom ? registerCustom : getPlinianPrompt(registerLevel);
  const reg = `${String(identity || "").trim()}\n\n${regText}`.trim();
  // Mirror injectGodmode(): "classic" is the auto-pick sentinel.
  const autoPicked = !godmodeLevel || godmodeLevel === "classic";
  const effectiveLevel = autoPicked && model ? pickGodmodeVariant(model) : (godmodeLevel || "classic");
  const god = getGodmodePrompt(effectiveLevel, godmodeCustom);
  // Mirror injectGlobal(): when the optional carrier is on, the payload is
  // spliced into the carrier's slot (or appended when the carrier has none).
  const carrierOn = carrierEnabled && (carrierCustom.trim() || carrierLevel);
  const finalPayload = carrierOn
    ? spliceCarrier(carrierCustom.trim() || getExternalPayload(carrierLevel) || "", god)
    : god;
  const finalCarrier = carrierOn ? (carrierCustom.trim() || getExternalPayload(carrierLevel) || "") : "";
  return {
    register: estimateTokens(reg),
    payload: estimateTokens(god),
    total: estimateTokens(reg + "\n\n" + finalPayload),
    effectiveLevel,
    carrier: finalCarrier ? estimateTokens(finalCarrier) : 0,
    carrierSpliced: !!(finalCarrier && finalCarrier.includes(CARRIER_SLOT)),
    autoPicked,
  };
}
