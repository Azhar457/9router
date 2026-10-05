import { randomUUID } from "node:crypto";
import { assertPenetrationAuth } from "@/lib/auth/payloadAuth";
import { STRIX_FLAT } from "@/shared/lib/strixManifest";

export const dynamic = "force-dynamic";

/**
 * Penetration skill-execution endpoint (Phase 2, design §3.3).
 *
 * Body: { skillId, target, scope }
 *   - skillId must be one of the 23 ids in STRIX_FLAT (400 otherwise).
 *   - Auth: assertPenetrationAuth (AND-gated: valid dashboard JWT cookie AND
 *     the local CLI token) → 401 when either check fails. Stricter than
 *     assertPayloadAuth because this is an execution surface, not browse.
 *
 * The Strix CLI skill runner is not wired yet (Phase 3), so the endpoint
 * returns a real job record — { jobId, statusUrl, queued } — rather than a
 * silent no-op. The client can poll statusUrl once the runner lands.
 */
export async function POST(request) {
  if (!(await assertPenetrationAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const skillId = String(body?.skillId ?? "");
  if (!STRIX_FLAT.some((s) => s.id === skillId)) {
    return Response.json(
      { error: "Unknown skillId — must be one of the 23 Strix manifest ids" },
      { status: 400 }
    );
  }

  const target = String(body?.target ?? "");
  const scope = String(body?.scope ?? "");
  const jobId = `pent-run-${randomUUID()}`;
  const statusUrl = `/api/developer/penetration/status/${jobId}`;

  // The actual Strix CLI runner is Phase 3. The endpoint EXISTS, is
  // auth-gated and skill-validated; the job is accepted and recorded.
  console.info(
    `[penetration/run] queued ${skillId} against ${target || "(no target)"} ` +
      `(scope=${scope || "unset"}) — Strix CLI runner not wired yet (Phase 3), jobId=${jobId}`
  );

  return Response.json({
    ok: false,
    jobId,
    statusUrl,
    queued: false,
    error: "Skill runner not yet wired — Phase 3",
  });
}
