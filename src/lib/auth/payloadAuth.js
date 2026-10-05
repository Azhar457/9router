import { cookies, headers } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;

async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

/**
 * Defense-in-depth auth gate for developer payload routes.
 * Independent of the global dashboardGuard middleware: requires either a
 * valid dashboard JWT cookie or the local CLI token. Returns true when
 * authenticated; callers return 401 when false.
 */
export async function assertPayloadAuth(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (await verifyDashboardAuthToken(token)) return true;

  const cliToken = headers().get(CLI_TOKEN_HEADER);
  if (cliToken && cliToken === (await getCliToken())) return true;

  return false;
}

/**
 * Stricter gate for skill-execution routes (penetration tab, design §5.3).
 * Requires a valid dashboard JWT cookie AND the local CLI token — BOTH
 * checks must pass, unlike assertPayloadAuth's OR-gate. Running a skill is
 * an execution surface, not a browse surface.
 */
export async function assertPenetrationAuth(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const jwtOk = await verifyDashboardAuthToken(token);
  const cliHeader = headers().get(CLI_TOKEN_HEADER);
  const cliOk = Boolean(cliHeader) && cliHeader === (await getCliToken());
  return jwtOk && cliOk;
}
