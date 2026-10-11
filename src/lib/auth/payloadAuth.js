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

  const cliToken = (await headers()).get(CLI_TOKEN_HEADER);
  if (cliToken && cliToken === (await getCliToken())) return true;

  return false;
}

/**
 * Penyesuaian untuk permintaan browser dari Origin yang sama.
 *
 * Browser tidak bisa memegang CLI token mesin, jadi gerbang AND murni membuat
 * tab penetration mustahil dijangkau dari UI. Yang tetap ditolak adalah
 * permintaan dari situs lain, karena browser selalu mengirim header Origin pada
 * POST lintas situs — jadi ini menutup lubang CSRF sambil membiarkan sesi
 * dashboard yang sudah login tetap bisa menjalankan pengujian.
 */
function isSameOriginBrowserRequest(request) {
  if (!request) return false;
  const headers = request.headers;
  if (!headers?.get) return false;
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (origin) {
    try {
      return host ? new URL(origin).host === host : false;
    } catch {
      return false;
    }
  }
  // Tanpa Origin: permintaan ini bukan browser lintas situs. Skrip lokal
  // (curl, CLI) juga tidak punya Origin, tapi tetap harus lewat CLI token.
  const site = headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

/**
 * Gate untuk route eksekusi skill (tab penetration, design §5.3).
 *
 * Terima: Token CLI mesin, atau sesi dashboard yang sah asal datang dari
 * Origin yang sama dengan host. menjalankan skill adalah permukaan eksekusi,
 * bukan sekadar tampilan — itu sebabnya gerbang ini lebih ketat daripada OR-gate
 * milik assertPayloadAuth.
 */
export async function assertPenetrationAuth(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const jwtOk = await verifyDashboardAuthToken(token);
  const cliHeader = (await headers()).get(CLI_TOKEN_HEADER);
  if (cliHeader && cliHeader === (await getCliToken())) return true;
  return jwtOk && isSameOriginBrowserRequest(request);
}
