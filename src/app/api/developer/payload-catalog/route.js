import { buildPayloadCatalog, isCarrierPayload, estTokensFromChars, spliceCarrier, CARRIER_SLOT } from "open-sse/payload/payloadCatalog.js";
import { getExternalPayload, getExternalPayloads } from "open-sse/payload/jailbreakPayloads.js";
import { getGodmodePrompt, GODMODE_LEVELS } from "open-sse/payload/godmodePayloads.js";

export const dynamic = "force-dynamic";

// The catalog is derived entirely from the in-memory payload registry, which
// is read once per process at module import and never changes afterwards.
// Without a cache every dashboard mount re-ran buildPayloadCatalog(), and that
// function re-scans each registered payload's full text to resolve its carrier
// flag. Memoizing in the route keeps the first load honest and makes every
// reload after it instant. TTL is kept short (10s) so custom payload uploads /
// renames / category changes surface in the picker within seconds — the
// loader registry refreshes on each CRUD write, and a 60s cache would show
// the stale list until the process effectively forgets it.
const CATALOG_CACHE_TTL_MS = 10_000;
let catalogCache = { at: 0, body: null };

// GET /api/developer/payload-catalog
// Metadata catalog for the payload selector: every payload row with
// cat / kind / sizeChars / estTokens / modelFamilies / effectiveness, plus
// live carrier detection (isCarrier resolved against actual text).
// This is the "catalog" layer — the developer page renders the selector and
// any sorting/ranking from this, not from re-scanning payload files.
export async function GET() {
  const now = Date.now();
  if (catalogCache.body && now - catalogCache.at < CATALOG_CACHE_TTL_MS) {
    return Response.json(catalogCache.body, {
      headers: { "Cache-Control": "private, max-age=10" },
    });
  }

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
    const body = {
      total: catalog.length,
      carriers: carriers.length,
      catalog,
      // convenience lists for the UI
      carrierIds: carriers.map((c) => c.id),
      byCategory: catalog.reduce((acc, r) => {
        (acc[r.cat] = acc[r.cat] || []).push(r.id);
        return acc;
      }, {}),
    };
    catalogCache = { at: Date.now(), body };
    return Response.json(body, {
      headers: { "Cache-Control": "private, max-age=10" },
    });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
