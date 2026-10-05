"use client";

import { useEffect, useState } from "react";
import { describeOutbound, SETTINGS_CHANGED_EVENT } from "@/shared/lib/outboundManifest";

// Always-visible outbound status: the user should never have to guess what
// this app sends beyond the core proxying lane. Green "Core-only" = no
// optional outbound feature is active; amber "N aktif" = expand for the list.
// Data never leaves this component — it only reads local settings.
export default function OutboundBadge() {
  const [features, setFeatures] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/settings", { cache: "no-store" })
        .then((r) => r.json())
        .then((settings) => {
          if (!cancelled) setFeatures(describeOutbound(settings));
        })
        .catch(() => {});
    };
    load();
    // The Transparency console toggles the same keys — keep the badge honest.
    globalThis.addEventListener?.(SETTINGS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      globalThis.removeEventListener?.(SETTINGS_CHANGED_EVENT, load);
    };
  }, []);

  if (!features) return null;
  const active = features.filter((f) => f.on);
  const coreOnly = active.length === 0;

  return (
    <details className="relative">
      <summary
        className={`flex cursor-pointer select-none list-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          coreOnly
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
            : "border-amber-500/40 bg-amber-500/10 text-amber-500"
        }`}
        title="Status outbound — klik untuk rincian"
      >
        <span className="material-symbols-outlined text-[14px]">shield</span>
        <span className="hidden sm:inline">
          {coreOnly ? "Core-only" : `${active.length} aktif`}
        </span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-[min(92vw,420px)] rounded-xl border border-border bg-surface p-3 shadow-xl">
        <p className="mb-2 text-xs font-semibold text-text-main">Outbound — apa yang keluar dari mesin ini</p>
        <ul className="max-h-72 space-y-1 overflow-auto">
          {features.map((f) => (
            <li key={f.key} className="flex items-start justify-between gap-2 text-[11px]">
              <span className="min-w-0">
                <span className="text-text-muted">{f.category} · </span>
                <span className={f.on ? "text-text-main" : "text-text-muted"}>{f.label}</span>
              </span>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-semibold uppercase ${
                  f.on
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                    : "border-border bg-surface-2 text-text-muted"
                }`}
              >
                {f.on ? "on" : "off"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-text-muted">
          Proxying inti (percakapan → provider pilihanmu) selalu jalan dan tidak termasuk daftar ini. Ubah lewat toggle
          per item di tab Transparency (Developer), atau lewat halaman Settings.
        </p>
      </div>
    </details>
  );
}
