import { NextResponse } from "next/server";
import { syncOmniRouteModels } from "@/lib/modelCatalog/omniSync";
import { getCustomModels } from "@/models";
import { isFreeModel, sortFreeFirst } from "@/lib/modelCatalog/omniSync";

export const dynamic = "force-dynamic";

// POST /api/models/omni-sync - Import new OmniRoute models into 9router.
// Body: { freeOnly?: boolean }
export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const result = await syncOmniRouteModels({ freeOnly: body.freeOnly === true });
    if (result.error && result.synced === 0) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.log("omni-sync error:", error);
    return NextResponse.json({ error: "omni-sync failed" }, { status: 500 });
  }
}

// GET /api/models/omni-sync - List imported OmniRoute models, free-first.
export async function GET() {
  try {
    const all = await getCustomModels();
    const synced = sortFreeFirst(all.map((m) => ({ ...m, isFree: m.caps?.isFree || isFreeModel(m) })));
    return NextResponse.json({ models: synced });
  } catch (error) {
    console.log("omni-sync list error:", error);
    return NextResponse.json({ error: "failed to list synced models" }, { status: 500 });
  }
}
