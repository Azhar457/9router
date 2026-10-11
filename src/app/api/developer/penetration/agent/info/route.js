import { assertPenetrationAuth } from "@/lib/auth/payloadAuth";
import { sandboxInfo } from "@/shared/lib/pentestSandbox.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/developer/penetration/agent/info
 *
 * Runtime container mana yang tersedia dan image-nya sudah siap, supaya GUI
 * bisa menampilkan pilihan yang benar dan memberi tahu lebih awal apakah harus
 * build image dulu.
 */
export async function GET(request) {
  if (!(await assertPenetrationAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await sandboxInfo());
}