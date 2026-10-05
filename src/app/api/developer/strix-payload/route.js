import { assertPayloadAuth } from "@/lib/auth/payloadAuth";
import { getStrixPayload, getStrixPayloads } from "open-sse/rtk/strixPayloads.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/developer/strix-payload?id=strix:vulnerabilities:sql_injection
 *
 * Returns the full markdown text of one Strix skill payload + metadata.
 * The Penetration tab loads this into an editable textarea so the user can
 * read exactly what ships into the model's system prompt before sending.
 *
 * GET /api/developer/strix-payload  (no id) → all 23 rows, metadata only.
 */
export async function GET(request) {
  if (!(await assertPayloadAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    // No id → metadata list (mirrors payload-catalog's Strix source filter)
    return Response.json({ rows: getStrixPayloads() });
  }

  const row = getStrixPayload(id);
  if (!row) {
    return Response.json(
      { error: `Unknown Strix payload: ${id}` },
      { status: 404 }
    );
  }

  return Response.json({
    id: row.id,
    cat: row.cat,
    name: row.name,
    description: row.description,
    sizeChars: row.sizeChars,
    estTokens: row.estTokens,
    text: row.text,
  });
}
