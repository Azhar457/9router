// Server-side tab-visibility controls. The PAYLOAD_TAB_* and PENETRATION_TAB_*
// env flags are not NEXT_PUBLIC-prefixed, so they are not inlined into the
// client bundle — the browser learns them through this endpoint instead.
// Read live on every request, so enterprise ops can flip the flags at
// runtime without a rebuild.
//
// Response shape (nested, per-tab):
// {
//   payload:     { disabled, hiddenFromNav, authRequired },
//   penetration: { disabled, hiddenFromNav, authRequired }
// }
import { NextResponse } from "next/server";

function isTrue(value) {
  return String(value || "") === "true" || String(value || "") === "1";
}

export async function GET() {
  return NextResponse.json({
    payload: {
      disabled: isTrue(process.env.NEXT_PUBLIC_DISABLE_PAYLOAD_TAB),
      hiddenFromNav: isTrue(process.env.PAYLOAD_TAB_HIDDEN),
      authRequired: isTrue(process.env.PAYLOAD_TAB_AUTH_REQUIRED),
    },
    penetration: {
      disabled: isTrue(process.env.NEXT_PUBLIC_DISABLE_PENETRATION_TAB),
      hiddenFromNav: isTrue(process.env.PENETRATION_TAB_HIDDEN),
      authRequired: isTrue(process.env.PENETRATION_TAB_AUTH_REQUIRED),
    },
  });
}
