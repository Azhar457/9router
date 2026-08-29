import { getGodmodePrompt } from "open-sse/rtk/godmodePayloads.js";
import { getPlinianPrompt } from "open-sse/rtk/plinianPrompts.js";
import { detect, estimateTokenSaver } from "@/shared/lib/injectionDetect.js";

export const runtime = "nodejs";

/**
 * Red-Team Transparency: reconstruct what the gateway injects (godmode +
 * plinian + identity), estimate token-saver impact on a sample tool_result,
 * and run injection/leak detection on the outbound request.
 * This is a viewer — it mirrors the same prompt functions chatCore uses, so
 * the displayed injection matches what a live request would carry.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const g = body?.godmode || {};
  const p = body?.plinian || {};

  const godmodeText = g.enabled ? getGodmodePrompt(g.level || "classic", typeof g.custom === "string" ? g.custom : "") : "";
  let plinianText = p.enabled ? getPlinianPrompt(p.level || "standard") : "";
  if (p.enabled && p.identity && p.identity.trim()) {
    plinianText = `${p.identity.trim()}\n\n---\n\n${plinianText}`;
  }

  const parts = [godmodeText, plinianText].filter(Boolean);
  const outboundSystem = parts.join("\n\n===\n\n");

  const draft = typeof body?.draft === "string" ? body.draft : "";
  const requestDetection = detect(`${outboundSystem}\n\n${draft}`);
  const tokenSaver = estimateTokenSaver(typeof body?.tokenSample === "string" ? body.tokenSample : "");

  return Response.json({
    godmodeText,
    plinianText,
    outboundSystem,
    requestDetection,
    tokenSaver,
  });
}
