import { listCaptures, getCapture, clearCaptures } from "@/lib/transparency/captureStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transparency console data — local-only capture feed.
 *
 * GET  /api/developer/transparency/captures           → list (newest last)
 * GET  /api/developer/transparency/captures?id=N      → one capture
 * GET  /api/developer/transparency/captures?limit=10  → tail
 * DELETE /api/developer/transparency/captures         → clear ring + journal
 *
 * Every capture is redacted at record time (see outboundCapture.js +
 * shared/lib/redact.js): API keys, OAuth tokens and base64 payloads never
 * reach this response.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id !== null && id !== "") {
      const capture = getCapture(id);
      if (!capture) {
        return Response.json({ error: { message: "Capture not found" } }, { status: 404 });
      }
      return Response.json({ capture });
    }
    const limitRaw = parseInt(searchParams.get("limit") || "", 10);
    const captures = listCaptures(Number.isFinite(limitRaw) ? limitRaw : undefined);
    return Response.json({ captures, count: captures.length });
  } catch (error) {
    return Response.json(
      { error: { message: error?.message || "failed to list captures" } },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    clearCaptures();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: { message: error?.message || "failed to clear captures" } },
      { status: 500 },
    );
  }
}
