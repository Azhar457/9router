"use client";

// usePayloadStatus — single source of truth for the header Shield indicator.
//
// The shield must be E2E, not a decoration: any change to any setting that
// affects outbound request shaping has to show up here without a reload.
// Three sync paths keep it honest:
//
//   1. Mount fetch          — initial state, and re-hydrates after a page nav.
//   2. SETTINGS_CHANGED_EVENT — every settings PATCH in the app dispatches this
//                              (see emitSettingsChanged below), so a toggle in
//                              the Jailbreaks card, the Penetration tab, the
//                              Transparency console or the Token Saver tab all
//                              propagate here instantly.
//   3. Focus / visibility   — settings can change from another tab, a CLI, or a
//                              second browser window; those paths never fire a
//                              local DOM event, so re-read on regain focus.
//
// Reads the raw persisted keys rather than any derived UI state, so the shield
// always describes what will actually be injected on the next /v1 request.

import { useCallback, useEffect, useState } from "react";
import { SETTINGS_CHANGED_EVENT } from "@/shared/lib/outboundManifest";
import { hasScopeAcknowledgement } from "@/shared/lib/tabConfig";

const EMPTY = {
  loaded: false,
  injectionEnabled: false,
  registerLevel: "",
  registerChars: 0,
  identity: "",
  payloadLevel: "",
  payloadLabel: "",
  payloadChars: 0,
  payloadTokens: 0,
  carrierWarp: false,
  skillRouterActive: false,
  skillRouterChars: 0,
  skillRouterTokens: 0,
  savers: { rtk: false, headroom: false, caveman: false, ponytail: false, pxpipe: false },
  saverCount: 0,
  pentestAcked: false,
};

// Any saver that actually rewrites request/response text. rtkEnabled ships
// true by default but is a compressor, not an injector, so it is reported
// separately from the injection group.
function derive(raw) {
  const s = raw || {};
  const registerCustom = typeof s.injectionRegisterCustom === "string" ? s.injectionRegisterCustom : "";
  const godmodeCustom = typeof s.injectionGodmodeCustom === "string" ? s.injectionGodmodeCustom : "";
  const registerLevel = s.injectionRegisterLevel || "none";
  const payloadLevel = s.injectionGodmodeLevel || "classic";
  const skillRouter =
    typeof s.injectionSkillRouterCustom === "string" ? s.injectionSkillRouterCustom.trim() : "";
  const identity = typeof s.injectionIdentity === "string" ? s.injectionIdentity.trim() : "";

  const savers = {
    rtk: !!s.rtkEnabled,
    headroom: !!s.headroomEnabled,
    caveman: !!s.cavemanEnabled,
    ponytail: !!s.ponytailEnabled,
    pxpipe: !!s.pxpipeEnabled,
  };

  // Payload size: custom text wins, otherwise fall back to the chars the
  // injection preview endpoint reports. Until that lands we only know custom.
  const payloadChars = godmodeCustom.length;
  const registerChars = registerCustom.length;

  return {
    loaded: true,
    injectionEnabled: !!s.injectionEnabled,
    registerLevel,
    registerChars,
    identity,
    payloadLevel,
    payloadLabel: payloadLevel === "custom" ? "custom" : payloadLevel,
    payloadChars,
    payloadTokens: payloadChars ? Math.max(1, Math.round(payloadChars / 4)) : 0,
    // v0.6.0 rework: the carrier warp now lives inside the Persona text
    // (injectionIdentity). The legacy injectionCarrier* keys are kept for
    // one-time data migration only — they are no longer part of the live
    // outbound pipeline.
    carrierWarp: identity.includes("[YOUR JAILBREAK HERE]"),
    skillRouterActive: !!skillRouter,
    skillRouterChars: skillRouter.length,
    skillRouterTokens: skillRouter ? Math.max(1, Math.round(skillRouter.length / 4)) : 0,
    savers,
    saverCount: Object.values(savers).filter(Boolean).length,
    pentestAcked: hasScopeAcknowledgement(),
  };
}

export function usePayloadStatus() {
  const [status, setStatus] = useState(EMPTY);

  const refresh = useCallback(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStatus(derive(data));
      })
      .catch(() => {
        if (!cancelled) setStatus((prev) => ({ ...prev, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refresh();
    const onChanged = () => refresh();
    globalThis.addEventListener?.(SETTINGS_CHANGED_EVENT, onChanged);
    // Settings can also change from another tab / another browser window,
    // which never fires a local DOM event.
    globalThis.addEventListener?.("focus", onChanged);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      globalThis.removeEventListener?.(SETTINGS_CHANGED_EVENT, onChanged);
      globalThis.removeEventListener?.("focus", onChanged);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return status;
}