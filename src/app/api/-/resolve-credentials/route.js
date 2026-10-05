// Internal, loopback-only credential resolver for the Go pipeline.
// The Go gateway (GO_PIPELINE=1) POSTs { model } here to get provider +
// upstream credentials so it can own the /v1/chat/completions hot path
// without touching the DB. Same trust model as custom-server.js's
// X-Real-IP loopback gate: only 127.0.0.1/::1 peers may reach it.
import { NextRequest, NextResponse } from "next/server";
import { getModelInfo } from "@/sse/services/model.js";
import { getProviderCredentials } from "@/sse/services/auth.js";

function isLoopback(req) {
  // custom-server.js stamps X-Real-IP from the TCP socket for loopback peers
  // and strips it otherwise, so an unspoofable client IP arrives there when
  // the request came through the Go gateway. Fall back to the raw socket.
  const realIp = req.headers.get("x-real-ip") || "";
  const remote = req.socket?.remoteAddress || req.ip || "";
  const cands = [realIp, remote, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || ""];
  return cands.some(
    (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost",
  );
}

export async function POST(req) {
  if (!isLoopback(req)) {
    return NextResponse.json({ error: "loopback only" }, { status: 403 });
  }

  let model;
  try {
    const body = await req.json();
    model = typeof body?.model === "string" ? body.model.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ error: "missing model" }, { status: 400 });
  }

  try {
    const modelInfo = await getModelInfo(model);
    if (!modelInfo?.provider) {
      // Combo (provider:null) or unresolvable — the Go pipeline can't handle
      // these, so surface a resolve failure and let the Go side fail open.
      return NextResponse.json({ error: "unresolvable model (combo or alias)" }, { status: 400 });
    }

    const credentials = await getProviderCredentials(modelInfo.provider, null, modelInfo.model);
    if (!credentials || credentials.allRateLimited) {
      return NextResponse.json({ error: "no active credentials" }, { status: 503 });
    }

    return NextResponse.json({
      provider: modelInfo.provider,
      model: modelInfo.model,
      baseUrl: credentials.providerSpecificData?.baseUrl ?? null,
      apiType: credentials.providerSpecificData?.apiType ?? "chat",
      apiKey: credentials.apiKey ?? credentials.accessToken ?? null,
      sourceFormat: "openai",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
