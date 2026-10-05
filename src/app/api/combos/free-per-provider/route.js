import { NextResponse } from "next/server";
import { curateFreeComboPerProvider } from "@/lib/modelCatalog/freeCombo";

export const dynamic = "force-dynamic";

// POST /api/combos/free-per-provider
// Body: { comboName?: string } — defaults to "unify".
// Pings every known free model in a capped parallel pool (concurrency 8,
// 15s timeout each), skips rate-limit / credit / quota failures, and
// upserts a combo holding exactly the lowest-latency survivor per provider.
export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const result = await curateFreeComboPerProvider({ comboName: body.comboName });
    if (result.error && result.models.length === 0) {
      return NextResponse.json({ error: result.error, ...result }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.log("free-per-provider combo error:", error);
    return NextResponse.json({ error: "Failed to curate free per-provider combo" }, { status: 500 });
  }
}
