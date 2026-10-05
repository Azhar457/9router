"use client";

import { useEffect, useState } from "react";

// Fetches the server-resolved tab flags (PAYLOAD_TAB_* / PENETRATION_TAB_*
// env controls) and merges them with the build-time NEXT_PUBLIC disable
// flags. Server values win so enterprise ops can flip the non-NEXT_PUBLIC
// flags at runtime.
//
// Shape (nested, per-tab):
//   {
//     payload:     { disabled, hiddenFromNav, authRequired },
//     penetration: { disabled, hiddenFromNav, authRequired },
//     loaded
//   }
export function useTabFlags() {
  const [flags, setFlags] = useState({
    payload: {
      disabled: globalThis.process?.env?.NEXT_PUBLIC_DISABLE_PAYLOAD_TAB === "true",
      hiddenFromNav: false,
      authRequired: false,
    },
    penetration: {
      disabled: globalThis.process?.env?.NEXT_PUBLIC_DISABLE_PENETRATION_TAB === "true",
      hiddenFromNav: false,
      authRequired: false,
    },
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tabs", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setFlags({
          payload: {
            disabled:
              data.payload?.disabled ||
              globalThis.process?.env?.NEXT_PUBLIC_DISABLE_PAYLOAD_TAB === "true",
            hiddenFromNav: data.payload?.hiddenFromNav,
            authRequired: data.payload?.authRequired,
          },
          penetration: {
            disabled:
              data.penetration?.disabled ||
              globalThis.process?.env?.NEXT_PUBLIC_DISABLE_PENETRATION_TAB === "true",
            hiddenFromNav: data.penetration?.hiddenFromNav,
            authRequired: data.penetration?.authRequired,
          },
          loaded: true,
        });
      })
      .catch(() => {
        // Fail-open: if the flag endpoint is unreachable the tabs keep
        // their default (visible) behavior — never lock the user out.
        if (!cancelled) setFlags((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return flags;
}
