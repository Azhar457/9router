"use client";

// ShieldStatus — the header Shield indicator.
//
// Compact by default: a single shield glyph whose color encodes whether
// anything outbound-shaping is active (injection, skill router, or savers).
// Clicking it opens a full transparency panel spelling out every one of those
// switches with its live state, so "what will actually ride my next request?"
// is one click away instead of a hunt through three tabs.
//
// Every value comes from usePayloadStatus(), which re-reads /api/settings on
// the settings-changed event, on window focus, and on tab visibility — so the
// panel reflects PATCHes made anywhere in the app, including other windows.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { usePayloadStatus } from "@/shared/hooks";
import { translate } from "@/i18n/runtime";

function Row({ icon, label, value, detail, tone = "off" }) {
  const toneClass =
    tone === "on"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : "text-text-muted/60";
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={cn("material-symbols-outlined text-[16px] mt-0.5 shrink-0", toneClass)}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-text-main">{label}</span>
          <span className={cn("text-[11px] font-semibold shrink-0", toneClass)}>{value}</span>
        </div>
        {detail && <span className="text-[10px] text-text-muted break-words">{detail}</span>}
      </div>
    </div>
  );
}

export default function ShieldStatus() {
  const s = usePayloadStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const injectionOn = s.injectionEnabled;
  const routerOn = s.skillRouterActive;
  const saversOn = s.saverCount > 0;
  const anyActive = injectionOn || routerOn || saversOn;
  // Green when only passive savers run; red once an actual payload is armed.
  const shieldTone = injectionOn ? "text-red-500" : anyActive ? "text-emerald-500" : "text-text-muted/60";

  const injectionValue = injectionOn
    ? translate("ON")
    : translate("OFF");
  const routerValue = routerOn ? translate("ON") : translate("OFF");
  const saverValue = saversOn ? `${s.saverCount} ${translate("on")}` : translate("OFF");
  const scopeValue = s.pentestAcked ? translate("acknowledged") : translate("not acknowledged");

  const saverDetail = saversOn
    ? [
        s.savers.rtk ? "RTK" : null,
        s.savers.headroom ? "Headroom" : null,
        s.savers.caveman ? "Caveman" : null,
        s.savers.ponytail ? "Ponytail" : null,
        s.savers.pxpipe ? "PxPipe" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={translate("Payload transparency")}
        title={translate("Payload transparency")}
        className={cn(
          "relative flex items-center justify-center size-10 rounded-lg transition-colors",
          "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5",
          open && "bg-black/5 dark:bg-white/5"
        )}
      >
        <span className={cn("material-symbols-outlined text-[22px] transition-colors", shieldTone)}>
          shield
        </span>
        {anyActive && (
          <span
            className={cn(
              "absolute right-1.5 top-1.5 size-1.5 rounded-full",
              injectionOn ? "bg-red-500" : "bg-emerald-500"
            )}
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <span className="text-sm font-semibold text-text-main">
              {translate("Outbound transparency")}
            </span>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wide",
                anyActive ? (injectionOn ? "text-red-500" : "text-emerald-500") : "text-text-muted"
              )}
            >
              {s.loaded ? (anyActive ? translate("active") : translate("idle")) : "…"}
            </span>
          </div>

          <div className="divide-y divide-border-subtle px-4 py-1">
            <Row
              icon="gavel"
              label={translate("Jailbreak payload")}
              value={injectionValue}
              tone={injectionOn ? "on" : "off"}
              detail={
                injectionOn
                  ? `${translate("register")} ${s.registerLevel}${s.identity ? ` + ${translate("identity")}` : ""} · ${translate("payload")} ${s.payloadLabel}${
                      s.payloadChars ? ` · ${s.payloadChars.toLocaleString()} ${translate("chars")}` : ""
                    }${s.carrierEnabled && s.carrierLevel ? ` · ${translate("carrier")} ${s.carrierLevel}` : ""}`
                  : translate("no payload added to any request")
              }
            />

            <Row
              icon="scanner"
              label={translate("Skill router (Strix)")}
              value={routerValue}
              tone={routerOn ? "on" : "off"}
              detail={
                routerOn
                  ? `${translate("pointer ships")} · ${s.skillRouterChars.toLocaleString()} ${translate("chars")} · ≈${s.skillRouterTokens} ${translate("tok")}`
                  : translate("Penetration tab ships nothing")
              }
            />

            <Row
              icon="savings"
              label={translate("Token savers")}
              value={saverValue}
              tone={saversOn ? "on" : "off"}
              detail={saversOn ? saverDetail : translate("all compressors off")}
            />

            <Row
              icon="shield"
              label={translate("Penetration scope")}
              value={scopeValue}
              tone={s.pentestAcked ? "warn" : "off"}
              detail={s.pentestAcked ? translate("authorized-target scope acknowledged") : translate("acknowledge the scope banner in the Penetration tab")}
            />
          </div>

          <div className="px-4 py-3 border-t border-border-subtle">
            <p className="text-[10px] text-text-muted">
              {translate(
                "These reflect the settings that shape the next request — they update the moment anything changes, no reload needed."
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}