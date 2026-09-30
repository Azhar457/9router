import { buildPayloadCatalog, isCarrierPayload, estTokensFromChars, spliceCarrier, CARRIER_SLOT } from "open-sse/rtk/payloadCatalog.js";
import { getExternalPayload, getExternalPayloads } from "open-sse/rtk/jailbreakPayloads.js";
import { getGodmodePrompt, GODMODE_LEVELS } from "open-sse/rtk/godmodePayloads.js";

export const dynamic = "force-dynamic";

// GET /api/developer/payload-catalog
// Metadata catalog for the payload selector: every payload row with
// cat / kind / sizeChars / estTokens / modelFamilies / effectiveness, plus
// live carrier detection (isCarrier resolved against actual text).
// This is the "catalog" layer — the developer page renders the selector and
// any sorting/ranking from this, not from re-scanning payload files.
export async function GET() {
  try {
    const catalog = buildPayloadCatalog();

    // Resolve live carrier flags + real size for file rows.
    for (const row of catalog) {
      const text = row.source === "file" ? getExternalPayload(row.id) : null;
      if (row.source === "file") {
        row.isCarrier = isCarrierPayload(text || "");
      }
      // Builtins already carry sizeChars from getGodmodePrompt.
      if (!row.estTokens && row.sizeChars) row.estTokens = estTokensFromChars(row.sizeChars);
    }

    const carriers = catalog.filter((r) => r.isCarrier || r.hasBuiltInCarrier);
    return Response.json({
      total: catalog.length,
      carriers: carriers.length,
      catalog,
      // convenience lists for the UI
      carrierIds: carriers.map((c) => c.id),
      byCategory: catalog.reduce((acc, r) => {
        (acc[r.cat] = acc[r.cat] || []).push(r.id);
        return acc;
      }, {}),
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
