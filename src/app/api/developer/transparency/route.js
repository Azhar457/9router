import { getGodmodePrompt, pickGodmodeVariant } from "open-sse/rtk/godmodePayloads.js";
import { getPlinianPrompt } from "open-sse/rtk/plinianPrompts.js";
import { detect, estimateTokenSaver, classifyPrompt } from "@/shared/lib/injectionDetect.js";

export const runtime = "nodejs";

/**
 * Red-Team Transparency: reconstruct what the gateway injects under the
 * unified Global Injection card — register (Plinian-style) + G0DM0D3
 * payload — estimate token-saver impact on a sample tool_result, and run
 * injection/leak detection on the outbound request.
 *
 * Accepts the unified `injection` shape:
 *   { enabled, level, godmodeLevel, godmodeCustom, identity, model? }
 * Falls back to the legacy separate `godmode` + `plinian` objects for
 * any caller that has not been migrated yet.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  // Unified shape: body.injection = { enabled, level, godmodeLevel, godmodeCustom, identity, model? }
  // Legacy: body.godmode + body.plinian
  const unified = body?.injection;
  const legacy = {
    godmode: body?.godmode || {},
    plinian: body?.plinian || {},
  };

  let enabled = false;
  let registerLevel = "standard";
  let identity = "";
  let godmodeLevel = "classic";
  let godmodeCustom = "";
  let model = "";

  if (unified && typeof unified === "object") {
    enabled = !!unified.enabled;
    registerLevel = typeof unified.level === "string" ? unified.level : "standard";
    identity = typeof unified.identity === "string" ? unified.identity : "";
    godmodeLevel = typeof unified.godmodeLevel === "string" ? unified.godmodeLevel : "classic";
    godmodeCustom = typeof unified.godmodeCustom === "string" ? unified.godmodeCustom : "";
    model = typeof unified.model === "string" ? unified.model : "";
  } else {
    enabled = !!legacy.godmode?.enabled || !!legacy.plinian?.enabled;
    registerLevel = legacy.plinian?.level || "standard";
    identity = typeof legacy.plinian?.identity === "string" ? legacy.plinian.identity : "";
    godmodeLevel = legacy.godmode?.level || "classic";
    godmodeCustom = typeof legacy.godmode?.custom === "string" ? legacy.godmode.custom : "";
  }

  // Build the register text. A custom register (from the UI editor) overrides
  // the preset level entirely — mirrors injectGlobal() in open-sse/rtk/
  // globalInject.js, which does exactly this. Identity prefixes in both cases.
  const registerCustom = typeof unified?.registerCustom === "string"
    ? unified.registerCustom
    : typeof legacy.plinian?.registerCustom === "string" ? legacy.plinian.registerCustom : "";

  let registerText = "";
  if (enabled) {
    if (registerCustom.trim()) {
      registerText = registerCustom.trim();
      if (identity && identity.trim()) {
        registerText = `${identity.trim()}\n\n---\n\n${registerText}`;
      }
    } else if (registerLevel) {
      registerText = getPlinianPrompt(registerLevel);
      if (identity && identity.trim()) {
        registerText = `${identity.trim()}\n\n---\n\n${registerText}`;
      }
    }
  }

  // Build the G0DM0D3 payload text — auto-pick per model when "classic" (default)
  let godmodeText = "";
  if (enabled && godmodeLevel) {
    const effectiveLevel =
      (godmodeLevel === "classic" || !godmodeLevel) && model
        ? pickGodmodeVariant(model)
        : godmodeLevel;
    godmodeText = getGodmodePrompt(effectiveLevel, godmodeCustom);
  }

  // Match live injection order: register first, payload second
  const parts = [registerText, godmodeText].filter(Boolean);
  const outboundSystem = parts.join("\n\n===\n\n");

  const draft = typeof body?.draft === "string" ? body.draft : "";
  const requestDetection = detect(`${outboundSystem}\n\n${draft}`);
  const harmClassification = draft ? classifyPrompt(draft) : null;
  const tokenSaver = estimateTokenSaver(typeof body?.tokenSample === "string" ? body.tokenSample : "");

  return Response.json({
    registerText,
    godmodeText,
    outboundSystem,
    requestDetection,
    harmClassification,
    tokenSaver,
  });
}
