"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Select } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { useTabFlags } from "@/shared/hooks";
import {
  CONSENT_EXPIRY_DAYS,
  getConsentState,
  recordConsent,
  revokeConsent,
} from "@/shared/lib/tabConfig";
import GlobalInjectionClient from "./GlobalInjectionClient";
import { STRIX_FLAT, STRIX_GROUPS } from "@/shared/lib/strixManifest";
import { onLocaleChange, translate } from "@/i18n/runtime";

// ── Consent gate ──────────────────────────────────────────────────────────────

function ConsentModal({ onConsent, onDismiss }) {
  const [ack, setAck] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payload-consent-title"
    >
      <div
        className={cn(
          "w-full max-w-md rounded-xl border-2 border-red-500/40 bg-surface shadow-2xl",
          "flex flex-col gap-4 p-6"
        )}
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-red-500">
            report_problem
          </span>
          <h2
            id="payload-consent-title"
            className="text-lg font-bold text-red-600 dark:text-red-400"
          >
            Security Research Only
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-text-main">
          This tab exposes offensive payload and injection tooling for{" "}
          <span className="font-semibold">authorized security research</span>{" "}
          only: red-team testing, jailbreak analysis, and adversarial
          robustness evaluation. Use it against systems you own or are
          explicitly authorized to test. Consent is recorded locally with a
          timestamp and expires after {CONSENT_EXPIRY_DAYS} days.
        </p>
        <label className="flex items-start gap-2 text-sm text-text-main cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 size-4 accent-red-500"
          />
          <span>I understand these tools are for authorized security research only</span>
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={!ack} onClick={onConsent}>
            I consent
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main client ───────────────────────────────────────────────────────────────

export default function PayloadTabClient() {
  const flags = useTabFlags();

  // Hydration-safe lazy init: read the consent store on the first client
  // render; getConsentState() returns null off-client, so SSR and the first
  // client render agree. The gate re-prompts when missing or expired.
  const [consent, setConsent] = useState(() => getConsentState());
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const consented = Boolean(consent?.consented);
  // The consent modal is visible when there's no valid consent and the user
  // hasn't explicitly dismissed it this session. Derived from state so no
  // setState-in-effect is needed; the modal auto-shows on mount when
  // consent is missing/expired.
  const showConsentModal = consented ? false : !bannerDismissed;

  const acceptConsent = useCallback(() => {
    recordConsent();
    setConsent(getConsentState());
  }, []);

  const revoke = useCallback(() => {
    revokeConsent();
    setConsent(getConsentState());
    setBannerDismissed(false);
  }, []);


  // RTK catalog
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((v) => v + 1)), []);
  const [rtkFilter, setRtkFilter] = useState("all");
  const [carrierIds, setCarrierIds] = useState([]);

  useEffect(() => {
    fetch("/api/developer/payload-catalog")
      .then((r) => r.json())
      .then((d) => {
        setCatalog(d.catalog || []);
        setCarrierIds(d.carrierIds || []);
      })
      .catch((e) => setCatalogError(String(e)))
      .finally(() => setCatalogLoading(false));
  }, []);

  // Godmode level + preview
  const [godmodeLevel, setGodmodeLevel] = useState("");
  const [godmodePreview, setGodmodePreview] = useState("");
  const [godmodePreviewLoading, setGodmodePreviewLoading] = useState(false);

  const previewGodmode = useCallback(async () => {
    if (!godmodeLevel.trim()) return;
    setGodmodePreviewLoading(true);
    setGodmodePreview("");
    try {
      const res = await fetch("/api/developer/godmode-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: godmodeLevel.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setGodmodePreview(data.text || "");
    } catch (e) {
      setGodmodePreview(`Error: ${e.message || String(e)}`);
    } finally {
      setGodmodePreviewLoading(false);
    }
  }, [godmodeLevel]);
  // Composition (carrier + payload splice). Splices client-side via the
  // carrier preview endpoint for built-in levels, or appends the payload
  // text after the carrier when the carrier has no slot.
  const [composition, setComposition] = useState({ carrier: "", payload: "" });
  const [compositionResult, setCompositionResult] = useState("");
  const [compositionLoading, setCompositionLoading] = useState(false);

  const carrierOptions = useMemo(() => {
    if (carrierIds.length) {
      return carrierIds.map((id) => ({ value: id, label: id }));
    }
    return catalog
      .filter((r) => r.isCarrier || r.hasBuiltInCarrier)
      .map((r) => ({ value: r.id, label: r.label || r.id }));
  }, [carrierIds, catalog]);

  const payloadOptions = useMemo(() => {
    const carrierSet = new Set(
      carrierIds.length
        ? carrierIds
        : catalog.filter((r) => r.isCarrier || r.hasBuiltInCarrier).map((r) => r.id)
    );
    return catalog
      .filter((r) => !carrierSet.has(r.id) && !r.isCarrier && !r.hasBuiltInCarrier)
      .map((r) => ({ value: r.id, label: r.label || r.id }));
  }, [carrierIds, catalog]);

  const compose = useCallback(async () => {
    const { carrier, payload } = composition;
    if (!carrier || !payload) return;
    setCompositionLoading(true);
    setCompositionResult("");
    try {
      const payloadRow = catalog.find((r) => r.id === payload);
      const level = payloadRow?.source === "builtin" ? payload : "classic";
      const res = await fetch("/api/developer/carrier-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, carrierLevel: carrier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCompositionResult(data.text || "(empty)");
    } catch (e) {
      setCompositionResult(`Error: ${e.message || String(e)}`);
    } finally {
      setCompositionLoading(false);
    }
  }, [composition, catalog]);

  // Strix
  const [strixSelected, setStrixSelected] = useState("");
  const selectedStrix = STRIX_FLAT.find((s) => s.id === strixSelected) || null;

  // Live Strix payload preview — keyed object so a skill switch never shows
  // the previous skill's text, and the "reset" happens by deriving a fresh
  // key object, not by calling setState inside the effect body.
  const [strixLoad, setStrixLoad] = useState({ key: null, preview: null, error: "" });
  const [strixNotice, setStrixNotice] = useState("");
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const strixPreview = strixLoad.key === strixSelected ? strixLoad.preview : null;
  const strixError = strixLoad.key === strixSelected ? strixLoad.error : "";
  useEffect(() => {
    if (!strixSelected) return;
    let cancelled = false;
    fetch(`/api/developer/strix-payload?id=${encodeURIComponent(strixSelected)}`)
      .then(async (res) => {
        if (res.status === 401) throw new Error("Unauthorized");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        if (cancelled) return;
        setStrixLoad({ key: strixSelected, preview: d, error: "" });
      })
      .catch((e) => {
        if (cancelled) return;
        setStrixLoad({ key: strixSelected, preview: null, error: e.message || String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [strixSelected]);

  // Copy the on-demand fetch URL for a Strix skill. Pointer mode means the
  // skill text is NEVER inlined into the system prompt — the agent pulls it
  // from this gateway when it decides it needs the methodology, so a skill
  // costs tokens only on the turns where it's actually used.
  const copyStrixFetchUrl = useCallback(async (skill) => {
    if (!skill?.id) return;
    const base =
      typeof window !== "undefined" && "location" in window
        ? window.location.origin
        : "http://localhost:20128";
    const url = `${base}/api/developer/skill-raw?skill=${encodeURIComponent(skill.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setStrixNotice(translate("Fetch URL copied — paste it into your agent."));
    } catch {
      setStrixNotice(translate("Clipboard unavailable — copy the URL from the address bar."));
    }
  }, []);

  // Filtered catalog rows
  const visibleCatalog = useMemo(() => {
    if (!catalog.length) return [];
    switch (rtkFilter) {
      case "builtin":
        return catalog.filter((r) => r.source === "builtin");
      case "jailbreak":
        return catalog.filter((r) => r.source === "file" && !r.isCarrier);
      case "carriers":
        return catalog.filter((r) => r.isCarrier || r.hasBuiltInCarrier);
      default:
        return catalog;
    }
  }, [catalog, rtkFilter]);

  // ── Disabled env state ─────────────────────────────────────────────────────
  if (flags.payload?.disabled) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text-main">Payload/Injection</h1>
          <Badge variant="error" dot>Security Research Only</Badge>
        </div>
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="material-symbols-outlined text-4xl text-text-muted">
              lock
            </span>
            <h2 className="text-base font-semibold text-text-main">
              Payload tab disabled
            </h2>
            <p className="max-w-sm text-sm text-text-muted">
              This deployment has the Payload/Injection tab turned off. Set{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                NEXT_PUBLIC_DISABLE_PAYLOAD_TAB=false
              </code>{" "}
              to enable it.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // ── Consent audit banner dates ─────────────────────────────────────────────
  const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString() : "—");
  const consentBannerDates = consented
    ? `${fmt(consent.consentAt)} · expires ${
        consent.expiresAt ? fmt(consent.expiresAt) : "90 days"
      }`
    : "";

  const filterChips = [
    { key: "all", label: "All" },
    { key: "builtin", label: "Built-in" },
    { key: "jailbreak", label: "Jailbreak Registry" },
    { key: "carriers", label: "Carriers" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Consent modal (first access or expired) */}
      {showConsentModal && (
        <ConsentModal
          onConsent={acceptConsent}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* Post-consent audit banner — small, dismissible */}
      {consented && !bannerDismissed && (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40",
            "bg-red-500/10 px-4 py-2.5 text-sm"
          )}
        >
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <span className="material-symbols-outlined text-[18px]">
              gavel
            </span>
            <span className="font-semibold">Security Research Only</span>
            <span className="text-text-muted">
              · consented {consentBannerDates}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={revoke}
              icon="revert"
            >
              Revoke
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss banner"
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-main">Payload/Injection</h1>
        <Badge variant="error" dot>Security Research Only</Badge>
      </div>
      {/* Global Injection (migrated from Developer tab) */}
      {consented && <GlobalInjectionClient payloadCatalog={catalog} />}
      {/* Payload/Injection Tools — preview, composition, and the full
          registry. Collapsed by default: the Global Injection card above
          already states what actually ships, so these are reference
          surfaces, not something you touch on every visit. */}
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setIsPreviewExpanded((v) => !v)}
          aria-expanded={isPreviewExpanded}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border border-border-subtle",
            "bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
          )}
        >
          <span className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[20px] text-text-muted">
              build
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-text-main">
                {translate("Payload/Injection Tools")}
              </span>
              <span className="text-[11px] text-text-muted">
                {translate("Godmode preview, carrier composition, and the full 63-entry registry")}
              </span>
            </span>
          </span>
          <span
            className={cn(
              "material-symbols-outlined text-[20px] text-text-muted transition-transform",
              isPreviewExpanded && "rotate-180"
            )}
          >
            expand_more
          </span>
        </button>

        {isPreviewExpanded && (
          <div className="flex flex-col gap-4">
        <Card
          title="Godmode Level Preview"
          subtitle="Fetch a godmode variant preview for a level (model left empty = default)"
          icon="psychology"
          elev
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={godmodeLevel}
                onChange={(e) => setGodmodeLevel(e.target.value)}
                placeholder="level (e.g. 1, 2, 3…)"
                className={cn(
                  "w-48 rounded-[10px] border border-red-500/40 bg-surface-2 px-3 py-2 text-sm text-text-main",
                  "focus:outline-none focus:ring-2 focus:ring-red-500/30"
                )}
              />
              <Button
                variant="danger"
                size="sm"
                icon="visibility"
                onClick={previewGodmode}
                loading={godmodePreviewLoading}
                disabled={!godmodeLevel.trim()}
              >
                Preview
              </Button>
            </div>
            {godmodePreview && (
              <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-text-main">
                {godmodePreview}
              </pre>
            )}
          </div>
        </Card>

        {/* Carrier + payload composition */}
        <Card
          title="Carrier + Payload Composition"
          subtitle="Pick a carrier and a payload to preview the spliced result"
          icon="join_inner"
          elev
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Carrier"
                placeholder="Select a carrier"
                value={composition.carrier}
                onChange={(v) =>
                  setComposition((c) => ({ ...c, carrier: v }))
                }
                options={carrierOptions}
              />
              <Select
                label="Payload"
                placeholder="Select a payload"
                value={composition.payload}
                onChange={(v) =>
                  setComposition((c) => ({ ...c, payload: v }))
                }
                options={payloadOptions}
              />
            </div>
            <div>
              <Button
                variant="danger"
                size="sm"
                iconRight="send"
                onClick={compose}
                loading={compositionLoading}
                disabled={!composition.carrier || !composition.payload}
              >
                Compose
              </Button>
            </div>
            {compositionResult && (
              <pre className="max-h-72 overflow-auto rounded-lg border border-red-500/20 bg-surface-2 p-3 text-xs leading-relaxed text-text-main">
                {compositionResult}
              </pre>
            )}
          </div>
        </Card>

        {/* RTK payload catalog */}
        <Card
          title="RTK Payload Catalog"
          subtitle="Godmode variants, jailbreak registry, and carriers"
          icon="inventory_2"
          elev
        >
          <div className="flex flex-col gap-3">
            {/* Filter chips */}
            <div className="flex flex-wrap items-center gap-2">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setRtkFilter(chip.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    rtkFilter === chip.key
                      ? "border-red-500 bg-red-500/15 text-red-600 dark:text-red-400"
                      : "border-border-subtle text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {catalogLoading ? (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Loading catalog…
              </p>
            ) : catalogError ? (
              <p className="flex items-center gap-2 text-sm text-red-500">
                <span className="material-symbols-outlined text-[18px]">error</span>
                {catalogError}
              </p>
            ) : visibleCatalog.length === 0 ? (
              <p className="text-sm text-text-muted">No rows match this filter.</p>
            ) : (
              <div className="flex flex-col">
                {visibleCatalog.map((row) => {
                  const carrier = row.isCarrier || row.hasBuiltInCarrier;
                  return (
                    <Card.ListItem
                      key={row.id}
                      className="gap-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-text-main">
                          {row.label || row.id}
                        </span>
                        <Badge variant="info" size="sm">
                          {row.cat || "uncategorized"}
                        </Badge>
                        <Badge
                          variant={row.effectiveness === "legacy" ? "warning" : "success"}
                          size="sm"
                          dot
                        >
                          {row.effectiveness || "current"}
                        </Badge>
                        {carrier && <Badge variant="primary" size="sm">carrier</Badge>}
                        <span className="text-xs text-text-muted">
                          {row.estTokens ? `${row.estTokens} tok` : "—"}
                        </span>
                        <span className="text-xs text-text-muted">
                          {Array.isArray(row.modelFamilies) && row.modelFamilies.length
                            ? row.modelFamilies.join(", ")
                            : "any"}
                        </span>
                      </div>
                    </Card.ListItem>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
          </div>
        )}
      </div>

      {/* Strix security payloads */}
      <Card
        title="Strix Security Payloads"
        subtitle="Migrated security-testing skills — click to read the full text"
        icon="security_update"
        elev
      >
        <div className="flex flex-col gap-4">
          {STRIX_GROUPS.map((group) => (
            <div key={group.cat} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
                <span className="material-symbols-outlined text-[16px] text-red-500">
                  folder
                </span>
                {group.label}
                <Badge variant="error" size="sm">
                  {group.items.length}
                </Badge>
              </h3>
              <div className="flex flex-col">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href="/dashboard/penetration"
                    onClick={(e) => {
                      e.preventDefault();
                      setStrixSelected(item.id);
                    }}
                    className={cn(
                      "-mx-3 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors",
                      "border-b border-border-subtle last:border-b-0",
                      strixSelected === item.id
                        ? "bg-red-500/10 ring-1 ring-red-500/40"
                        : "hover:bg-surface-2/50"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-text-main">
                      {item.name}
                      <Badge variant="info" size="sm">
                        {item.cat}
                      </Badge>
                    </span>
                    <span className="text-xs text-text-muted">{item.size}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}

          {/* Detail panel for the selected Strix payload — live fetch of the
              full text from /api/developer/strix-payload, mirroring the
              transparency of the Global Injection card (readable payload,
              char/token count, what ships). */}
          {selectedStrix && (
            <div className="flex flex-col gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-red-500">
                  description
                </span>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {selectedStrix.name}
                </span>
                <Badge variant="error" size="sm">
                  {selectedStrix.cat}
                </Badge>
                {strixPreview?.sizeChars ? (
                  <Badge variant="warning" size="sm">
                    {strixPreview.sizeChars.toLocaleString()} {translate("chars")} · ≈{strixPreview.estTokens.toLocaleString()} {translate("tok")}
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    {selectedStrix.size}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-text-muted">
                {selectedStrix.description || selectedStrix.name}
              </p>
              {strixPreview?.text ? (
                <>
                  <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main">
                    {strixPreview.text}
                  </pre>
                  {strixNotice && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {strixNotice}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">
                      {translate("Full text readable above · the agent fetches this on demand, never inlined")} —{" "}
                      <a
                        href="/dashboard/penetration"
                        className="underline decoration-red-500/50 underline-offset-2"
                      >
                        {translate("Penetration tab")}
                      </a>{" "}
                      {translate("ships the pointer.")}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconRight="content_copy"
                      onClick={() =>
                        copyStrixFetchUrl(selectedStrix)
                      }
                    >
                      {translate("Copy fetch URL")}
                    </Button>
                  </div>
                </>
              ) : (
                strixError && (
                  <p className="text-xs text-red-500">{strixError}</p>
                )
              )}
            </div>
          )}
        </div>
      </Card>

    </div>
  );
}
