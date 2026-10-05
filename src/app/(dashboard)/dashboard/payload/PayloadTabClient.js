"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
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


  // RTK catalog — supplies `payloadCatalog` to GlobalInjectionClient, the
  // single source of truth for what ships. The reference accordion that
  // used to browse/preview/compose from this catalog was removed because
  // the Global Injection card already exposes all three surfaces (level
  // preview, carrier composition, and the full registry).
  const [catalog, setCatalog] = useState([]);
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((v) => v + 1)), []);

  useEffect(() => {
    fetch("/api/developer/payload-catalog")
      .then((r) => r.json())
      .then((d) => setCatalog(d.catalog || []))
      .catch((e) => console.warn("payload-catalog fetch failed", e));
  }, []);

  // Strix
  const [strixSelected, setStrixSelected] = useState("");
  const selectedStrix = STRIX_FLAT.find((s) => s.id === strixSelected) || null;

  // Live Strix payload preview — keyed object so a skill switch never shows
  // the previous skill's text, and the "reset" happens by deriving a fresh
  // key object, not by calling setState inside the effect body.
  const [strixLoad, setStrixLoad] = useState({ key: null, preview: null, error: "" });
  const [strixNotice, setStrixNotice] = useState("");
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
  const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US") : "—");
  const consentBannerDates = consented
    ? `${fmt(consent.consentAt)} · expires ${
        consent.expiresAt ? fmt(consent.expiresAt) : "90 days"
      }`
    : "";

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
                    {strixPreview.sizeChars.toLocaleString("en-US")} {translate("chars")} · ≈{strixPreview.estTokens.toLocaleString("en-US")} {translate("tok")}
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
