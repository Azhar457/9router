import { assertPayloadAuth } from "@/lib/auth/payloadAuth";
import { getStrixPayload, getStrixPayloads } from "open-sse/rtk/strixPayloads.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/developer/skill-raw?skill=strix:cloud:aws
 *
 * Serves the full markdown of one Strix skill as plain text — the endpoint
 * the SKILL-ROUTER-STRIX payload points the agent at. Mirrors the "Read this
 * skill and use it: <raw-url>" pattern used on the Skills dashboard tab, but
 * against this local gateway instead of a GitHub raw URL.
 *
 * Content-Type is text/plain so a model's web-fetch / HTTP tool can read it
 * directly without JSON decoding.
 */
export async function GET(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const skill = url.searchParams.get("skill");

  if (!skill) {
    // No id → plain-text skill index (mirrors the router payload's index)
    const lines = getStrixPayloads().map(
      (s) =>
        `- ${s.id} — ${s.description || s.name} (${(s.sizeChars / 1024).toFixed(1)}k)`
    );
    return new Response(`Strix skill index (${lines.length} skills)\n\n${lines.join("\n")}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const row = getStrixPayload(skill);
  if (!row) {
    return new Response(`Unknown Strix skill: ${skill}`, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(row.text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
