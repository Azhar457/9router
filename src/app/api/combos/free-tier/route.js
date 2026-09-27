import { NextResponse } from "next/server";
import { curateFreeCombo } from "@/lib/modelCatalog/freeCombo";

export const dynamic = "force-dynamic";

// POST /api/combos/free-tier
// Body (all optional):
//   { comboName?: string, prompt?: string, concurrency?: number,
//     perCallTimeoutMs?: number, skipBenchmark?: boolean }
export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const opts = {
      comboName: body.comboName,
      prompt: body.prompt,
      concurrency: body.concurrency,
      perCallTimeoutMs: body.perCallTimeoutMs,
      skipBenchmark: body.skipBenchmark === true,
    };
    const result = await curateFreeCombo(opts);
    if (result.error && result.models.length === 0) {
      return NextResponse.json({ error: result.error, ...result }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.log("free-tier combo error:", error);
    return NextResponse.json({ error: "Failed to curate free combo" }, { status: 500 });
  }
}
