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

  // Hydration-safe initial state: SSR and the first client render must agree.
  // getConsentState() reads localStorage, which is unavailable on the server,
  // so calling it during render produces different HTML for SSR vs client
  // (consented:false vs consented:true) → hydration mismatch. We therefore
  // start from the empty shape and sync the real consent state in an effect
  // after mount, when localStorage is available.
  const [consent, setConsent] = useState(() => ({
    consented: false,
    consentAt: null,
    expiresAt: null,
    audit: [],
  }));
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [consentHydrated, setConsentHydrated] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setConsent(getConsentState());
      setConsentHydrated(true);
    });
  }, []);

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

  useEffect(() => {
    fetch("/api/developer/payload-catalog")
      .then((r) => r.json())
      .then((d) => setCatalog(d.catalog || []))
      .catch((e) => console.warn("payload-catalog fetch failed", e));
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
      {/* Consent modal (first access or expired). Gated on
          consentHydrated so the SSR placeholder and the first client
          render agree, then the real gate appears after mount. */}
      {consentHydrated && showConsentModal && (
        <ConsentModal
          onConsent={acceptConsent}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* Post-consent audit banner — small, dismissible */}
      {consentHydrated && consented && !bannerDismissed && (
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

      {/* Strix security payloads live on their own tab: /dashboard/strix */}

    </div>
  );
}
