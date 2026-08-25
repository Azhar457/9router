import { getPlinianPrompt } from "open-sse/rtk/plinianPrompts.js";

export const dynamic = "force-dynamic";

/**
 * Transparency endpoint for the Global Plinian injection card: returns the
 * EXACT text injectPlinian appends for the selected level (+ optional
 * identity prefix), so the UI can render a WYSIWYG preview.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const level = String(body?.level || "standard");
  const identity = typeof body?.identity === "string" ? body.identity.trim() : "";
  const base = getPlinianPrompt(level);
  const text = identity ? `${identity}\n\n${base}` : base;

  return Response.json({ level, chars: text.length, text });
}
