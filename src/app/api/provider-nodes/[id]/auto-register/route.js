import { NextResponse } from "next/server";
import { getProviderNodeById, getProviderConnections, getCustomModels, addCustomModel, updateProviderNode } from "@/lib/localDb";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { UPDATER_CONFIG } from "@/shared/constants/config";

export const dynamic = "force-dynamic";

// Guess a model's service kind from its id. Same rules as /v1/models but
// self-contained so the auto-register endpoint doesn't import the whole
// models route (which pulls the provider registry + live resolvers).
function inferKind(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/video|film|clip|animate/.test(lower)) return "video";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion|banana|pic/.test(lower)) return "image";
  if (/search|browse|web/.test(lower)) return "webSearch";
  return "llm";
}

// Media kinds the endpoint can auto-register. chat/llm models are already
// reachable through the node; only media kinds need an explicit entry.
const MEDIA_KINDS = new Set(["image", "video", "embedding", "tts", "stt"]);

/**
 * POST /api/provider-nodes/[id]/auto-register
 *
 * Body: { test: true } — run the ping gate (default, recommended).
 *
 * 1. Load the node + one active connection for it (for the upstream API key).
 * 2. Fetch {baseUrl}/models upstream (OpenAI-compatible shape).
 * 3. For every media-looking model id not already registered for this node,
 *    infer its kind and ping the matching /v1 endpoint with that model.
 * 4. Register the ping-passing models into customModels and merge their kinds
 *    into the node's serviceKinds.
 *
 * Only models that PASS the ping get registered — a model that 404s upstream
 * is not registered, so the media tab never lists a broken model.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);
    if (!node) return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    if (node.type !== "openai-compatible" && node.type !== "anthropic-compatible") {
      return NextResponse.json({ error: "Auto-register only supports OpenAI/Anthropic-compatible nodes" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const runTest = body.test !== false; // default true — the mandatory gate

    // One active connection carries the upstream key + baseUrl.
    const conns = (await getProviderConnections({ provider: id, isActive: true })).filter((c) => c.isActive !== false);
    if (!conns.length) return NextResponse.json({ error: "No active connection on this node — add one first" }, { status: 400 });
    const conn = conns[0];
    const baseUrl = typeof conn?.providerSpecificData?.baseUrl === "string"
      ? conn.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
      : "";
    if (!baseUrl) return NextResponse.json({ error: "Node has no baseUrl configured" }, { status: 400 });

    // 1. Fetch upstream model catalog.
    let upstreamModels = [];
    try {
      const headers = { "Content-Type": "application/json", "Accept": "application/json" };
      const isAnthropic = node.type === "anthropic-compatible";
      if (isAnthropic) headers["x-api-key"] = conn.apiKey || "";
      else headers["Authorization"] = `Bearer ${conn.apiKey || ""}`;
      const upstreamUrl = isAnthropic ? `${baseUrl}/models` : `${baseUrl}/models`;
      const resp = await fetch(upstreamUrl, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        upstreamModels = arr.map((m) => ({ id: m.id || m.model, name: m.name || m.id })).filter((m) => m.id);
      }
    } catch { /* upstream /models optional — fall back to registered models only */ }

    // 2. Seed candidate pool: upstream ids + already-registered custom models.
    const existingCustom = (await getCustomModels()).filter((m) => m.providerAlias === node.prefix || m.providerAlias === id);
    const seen = new Set();
    const candidates = [];
    for (const m of [...upstreamModels, ...existingCustom]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const kind = inferKind(m.id);
      if (!MEDIA_KINDS.has(kind)) continue; // only auto-register media kinds
      const already = existingCustom.some((e) => e.id === m.id && (e.type || "llm") === kind);
      candidates.push({ id: m.id, name: m.name, kind, alreadyRegistered: already });
    }

    const prefix = node.prefix || id;
    const results = [];
    const kindsToAdd = new Set((node.serviceKinds || []));
    let registered = 0;

    for (const c of candidates) {
      const row = { model: c.id, kind: c.kind, alreadyRegistered: c.alreadyRegistered };
      if (c.alreadyRegistered) {
        row.status = "registered";
        kindsToAdd.add(c.kind);
        results.push(row);
        continue;
      }
      // Mandatory test gate: only register models that actually respond.
      if (runTest) {
        const ping = await pingModelByKind(`${prefix}/${c.id}`, c.kind, `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`).catch((e) => ({ ok: false, error: e?.message || "ping failed" }));
        row.pingOk = ping.ok;
        row.pingMs = ping.latencyMs;
        row.pingError = ping.error;
        if (!ping.ok) { row.status = "skipped-test"; results.push(row); continue; }
      }
      try {
        await addCustomModel({ providerAlias: prefix, id: c.id, type: c.kind, name: c.name || c.id });
        row.status = "added";
        row.tested = runTest;
        kindsToAdd.add(c.kind);
        registered += 1;
      } catch (e) {
        row.status = "error";
        row.error = e?.message;
      }
      results.push(row);
    }

    // Merge discovered kinds into the node's serviceKinds so the media tab
    // lists this node for them.
    const newKinds = [...kindsToAdd];
    const serviceKindsChanged = newKinds.length !== (node.serviceKinds || []).length;
    if (serviceKindsChanged) {
      await updateProviderNode(id, { ...node, serviceKinds: newKinds });
    }

    return NextResponse.json({
      ok: true,
      node: id,
      prefix,
      scanned: candidates.length,
      registered,
      serviceKinds: newKinds,
      results,
    });
  } catch (error) {
    return NextResponse.json({ error: `Auto-register failed: ${error?.message || error}` }, { status: 500 });
  }
}
