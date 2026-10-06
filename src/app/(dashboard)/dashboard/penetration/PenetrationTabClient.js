"use client";

// Penetration tab — SKILL-ROUTER-STRIX card, mirroring the Global Injection
// card (same header row + ON/OFF + expand + numbered sections ①②③④ +
// outbound-system panel).
//
// Distinction from the Payload tab:
//   Payload tab   → jailbreak payloads (G0DM0D3, NYX, Cronus, …) — inlining
//                   the full prompt text so the model breaks out of alignment.
//   Penetration   → SKILL-ROUTER-STRIX — a compact index (~2 KB) that tells
//                   the agent WHERE to pull the full security-testing skills
//                   from this local gateway, instead of shipping 8–24 KB per
//                   skill. The agent fetches on demand via /api/developer/
//                   skill-raw, same pattern as the Skills tab's "Read this
//                   skill and use it: <url>" prompt.
//
// The composed payload is injected via the SEPARATE injectionSkillRouterCustom
// settings slot (NOT injectionGodmodeCustom — that stays jailbreak-only), so
// the SKILL-ROUTER-STRIX index and the jailbreak payload can coexist without
// clobbering each other. Both ride the same global-inject pipeline; they
// ship as two independent blocks in the system message.
//
// i18n: every user-facing string goes through translate() from @/i18n/runtime.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { useTabFlags } from "@/shared/hooks";
import {
  hasScopeAcknowledgement,
  recordScopeAcknowledgement,
  revokeScopeAcknowledgement,
  SCOPE_ACK_EXPIRY_DAYS,
} from "@/shared/lib/tabConfig";
import { STRIX_FLAT } from "@/shared/lib/strixManifest";
import { onLocaleChange, translate } from "@/i18n/runtime";

const STRIX_CATEGORIES = [
  { key: "vulnerabilities", label: "Vulnerabilities" },
  { key: "frameworks", label: "Frameworks" },
  { key: "cloud", label: "Cloud" },
  { key: "top-level", label: "Top-Level Skills" },
];

const SCOPE_OPTIONS = [
  { value: "web", label: "web" },
  { value: "api", label: "api" },
  { value: "infra", label: "infra" },
  { value: "agent", label: "agent" },
];

// ── Scope banner ──────────────────────────────────────────────────────────────
// `acked` is the persisted flag passed from the parent. The parent starts it
// false on the server (no localStorage) and syncs to the real value in a
// useEffect, so the first client render matches the server HTML (no hydration
// mismatch). The local `ack` below is only the in-flight checkbox state.
function ScopeBanner({ acked, onAcknowledge, onRevoke }) {
  const [ack, setAck] = useState(false);

  if (acked) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40",
          "bg-amber-500/10 px-4 py-2.5 text-sm"
        )}
      >
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <span className="material-symbols-outlined text-[18px]">verified</span>
          <span className="font-semibold">{translate("Scope acknowledged")}</span>
          <span className="text-text-muted">
            {translate("expires in")} {SCOPE_ACK_EXPIRY_DAYS}
          </span>
        </div>
        <Button variant="ghost" size="sm" icon="revert" onClick={onRevoke}>
          {translate("Revoke")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-red-500/40",
        "bg-red-500/10 px-4 py-4 text-sm"
      )}
      role="alert"
    >
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
        <span className="material-symbols-outlined text-[20px]">warning</span>
        <span className="font-semibold">{translate("Penetration mode active")}</span>
      </div>
      <p className="text-text-main leading-relaxed">
        {translate(
          "The skill router below ships verbatim into the model's system prompt. It tells the agent which security skills to pull from this gateway and where. Review targets + scope before activating."
        )}
      </p>
      <label className="flex items-start gap-2 text-sm text-text-main cursor-pointer select-none">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5 size-4 accent-red-500"
        />
        <span>
          {translate(
            "I understand the scope — the SKILL-ROUTER payload will be injected into every /v1 request while ON."
          )}
        </span>
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="danger"
          size="sm"
          disabled={!ack}
          onClick={() => {
            recordScopeAcknowledgement();
            onAcknowledge();
          }}
        >
          {translate("Acknowledge")}
        </Button>
      </div>
    </div>
  );
}

// ── Main client ───────────────────────────────────────────────────────────────

export default function PenetrationTabClient() {
  const flags = useTabFlags();

  const [acknowledged, setAcknowledged] = useState(false);

  // Hydrate the persisted scope-acknowledgement state on the client only.
  // The server render and the client's first render both use the initial
  // value (false) so React hydration matches. Reading localStorage in a
  // useState initializer makes the SSR output (no localStorage) diverge
  // from the client's real value and triggers a hydration mismatch.
  useEffect(() => {
    queueMicrotask(() => setAcknowledged(hasScopeAcknowledgement()));
  }, []);

  const [open, setOpen] = useState(true);

  const [selectedSkillIds, setSelectedSkillIds] = useState([]);
  const [includeAll, setIncludeAll] = useState(true);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [openCats, setOpenCats] = useState({ vulnerabilities: true });

  const [target, setTarget] = useState("");
  const [scope, setScope] = useState("");

  const [baseUrl, setBaseUrl] = useState(
    () =>
      typeof window !== "undefined" && "location" in window
        ? window.location.origin
        : ""
  );

  const [payloadText, setPayloadText] = useState("");
  const [payloadEditing, setPayloadEditing] = useState(false);

  const [injectOn, setInjectOn] = useState(false);
  const [skillRouterText, setSkillRouterText] = useState("");

  const [sending, setSending] = useState(false);
  const [sendState, setSendState] = useState({ status: "idle", message: "" });

  // Hydrate ON state + existing skill-router text from settings on mount so
  // the card reflects the real slot (injectionSkillRouterCustom) instead of
  // always starting OFF with an empty editor.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled || !s) return;
        const text = typeof s.injectionSkillRouterCustom === "string" ? s.injectionSkillRouterCustom : "";
        setInjectOn(!!(s.injectionEnabled !== undefined ? !!s.injectionEnabled : (s.plinianEnabled || s.godmodeEnabled)) && text.trim());
        setSkillRouterText(text);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // i18n: re-render when locale changes so translate() picks up the map.
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((v) => v + 1)), []);

  // ── What actually ships: a ONE-LINE pointer, not the index ───────────────
  // Token discipline: shipping all 23 skill ids + descriptions costs ~2.4k tok
  // on EVERY request whether the agent needs them or not. The pointer costs
  // ~50 tok and names the two endpoints; the agent then pulls the index and
  // the 1–3 skills it actually needs. The full index below stays as a local
  // preview — readable, editable, copyable — but is NOT what gets injected.
  const routerPayload = useMemo(() => {
    if (!includeAll && !selectedSkillIds.length) return "";
    const effectiveBase = baseUrl || "http://localhost:20128";
    const lines = [
      "[STRIX-POINTER] Authorized security-testing skills are available on demand — fetch before analyzing a target, do not guess at methodology.",
    ];
    if (target || scope) {
      lines.push(
        `Scope: ${target || "unset"}${scope ? ` · ${scope}` : ""}. Authorized target only — no live exploitation, analysis and remediation only.`
      );
    }
    lines.push(
      `List: GET ${effectiveBase}/api/developer/skill-raw   |   One skill: GET ${effectiveBase}/api/developer/skill-raw?skill=<id>   (plain markdown, no auth prompt).`
    );
    return lines.join("\n");
  }, [includeAll, selectedSkillIds, target, scope, baseUrl]);

  // Local-only preview of the full index — for reading and copying by hand.
  // Never injected. Mirrors the server-side buildStrixSkillRouterPayload.
  const fullIndexPreview = useMemo(() => {
    const skills = includeAll
      ? STRIX_FLAT
      : STRIX_FLAT.filter((s) => selectedSkillIds.includes(s.id));
    if (!skills.length) return "";
    const effectiveBase = baseUrl || "http://localhost:20128";
    const lines = [
      "# SKILL-ROUTER-STRIX — Security Skill Router",
      "",
      `Authorized penetration-testing context. Target: ${target || "(unset)"}${scope ? ` · scope: ${scope}` : ""}.`,
      "Rules: engage only the authorized target. No live exploitation — analysis, detection, and remediation only.",
      "",
      "## Skill index",
    ];
    for (const cat of STRIX_CATEGORIES) {
      const items = skills.filter((s) => s.cat === cat.key);
      if (!items.length) continue;
      lines.push(`### ${cat.label}`);
      for (const s of items) {
        lines.push(`- \`${s.id}\` — ${s.name} (${s.size})`);
      }
      lines.push("");
    }
    lines.push("## How to pull a skill");
    lines.push("Fetch the full markdown for skill `<id>` from this gateway:");
    lines.push(`  GET ${effectiveBase}/api/developer/skill-raw?skill=<id>`);
    lines.push("");
    lines.push("## Usage protocol");
    lines.push("1. Pick the 1–3 skill ids whose methodology best matches the target stack.");
    lines.push("2. Fetch each selected skill's full text via the URL above.");
    lines.push("3. Apply that skill's methodology to the target — findings, severity, evidence, remediation.");
    lines.push("4. If a skill references a tool that is unavailable, state the limitation and continue with what you can.");
    return lines.join("\n");
  }, [includeAll, selectedSkillIds, target, scope, baseUrl]);

  const fullIndexTokens = fullIndexPreview
    ? Math.max(1, Math.round(fullIndexPreview.length / 4))
    : 0;

  const estTokens = routerPayload
    ? Math.max(1, Math.round(routerPayload.length / 4))
    : 0;

  const skillPrompt = baseUrl
    ? `Read this skill and use it: ${baseUrl}/api/developer/skill-raw`
    : "";

  const copySkillPrompt = useCallback(async () => {
    if (!skillPrompt) return;
    try {
      await navigator.clipboard.writeText(skillPrompt);
      setSendState({ status: "copied", message: translate("Skill prompt copied") });
    } catch {
      setSendState({ status: "error", message: translate("Clipboard unavailable") });
    }
  }, [skillPrompt]);

  const activate = useCallback(async () => {
    if (!routerPayload) return;
    setSending(true);
    setSendState({ status: "sending", message: "" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Separate slot: jailbreak payload (injectionGodmodeCustom) stays
          // untouched; skill router rides alongside it independently.
          injectionEnabled: true,
          injectionSkillRouterCustom: routerPayload,
        }),
      });
      if (!res.ok)
        throw new Error(translate("settings patch failed") + ` (HTTP ${res.status})`);
      setInjectOn(true);
      setSkillRouterText(routerPayload);
      setSendState({
        status: "sent",
        message: translate("SKILL-ROUTER active — ships on every /v1 request"),
      });
    } catch (e) {
      setSendState({ status: "error", message: e.message || String(e) });
    } finally {
      setSending(false);
    }
  }, [routerPayload]);

  const deactivate = useCallback(async () => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Clear only the skill router slot — leave jailbreak payload
          // settings alone (it may be independently active).
          injectionSkillRouterCustom: "",
        }),
      });
      setInjectOn(false);
      setSkillRouterText("");
      setSendState({ status: "idle", message: translate("Deactivated") });
    } catch {
      setInjectOn(false);
    }
  }, []);

  // ── Disabled env state ───────────────────────────────────────────────────
  if (flags?.penetration?.disabled) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text-main">{translate("Penetration")}</h1>
          <Badge variant="error" dot>{translate("Security Research Only")}</Badge>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface/40 py-10 text-center">
          <span className="material-symbols-outlined text-4xl text-text-muted">lock</span>
          <h2 className="text-base font-semibold text-text-main">
            {translate("Penetration tab disabled")}
          </h2>
          <p className="max-w-sm text-sm text-text-muted">
            Set{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
              NEXT_PUBLIC_DISABLE_PENETRATION_TAB=false
            </code>{" "}
            {translate("to enable it.")}
          </p>
        </div>
      </div>
    );
  }

  // Status subtitle reflects what is actually IN the slot right now: while ON
  // that is the persisted pointer text (not a recomputed preview), so the
  // number always matches what ships.
  const activeText = injectOn && skillRouterText.trim()
    ? `${translate("Active for all tabs & all clients — pointer only")} · ${skillRouterText.length.toLocaleString("en-US")} ${translate("chars")} · ≈${Math.max(1, Math.round(skillRouterText.length / 4))} ${translate("tok")}`
    : "";

  const editedText = payloadEditing
    ? `${translate("Edited")} · ${payloadText.length.toLocaleString("en-US")} ${translate("chars")} · ≈${Math.max(1, Math.round(payloadText.length / 4))} ${translate("tok")}`
    : "";

  return (
    <div className="flex flex-col gap-6">
      <ScopeBanner
        acked={acknowledged}
        onAcknowledge={() => setAcknowledged(true)}
        onRevoke={() => {
          revokeScopeAcknowledgement();
          setAcknowledged(false);
        }}
      />

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-main">{translate("Penetration")}</h1>
        <Badge variant="error" dot>{translate("Security Research Only")}</Badge>
      </div>

      <div className="rounded-xl border border-border bg-surface/40">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          <span
            className={cn(
              "material-symbols-outlined text-[20px]",
              injectOn ? "text-primary" : "text-text-muted"
            )}
          >
            bolt
          </span>
          <div className="flex min-w-[220px] flex-col">
            <span className="text-sm font-medium text-text-main">
              {translate("SKILL-ROUTER-STRIX")}
            </span>
            <span className="text-xs text-text-muted">
              {injectOn
                ? activeText
                : translate("OFF — no skill router injected")}
            </span>
          </div>
          <button
            onClick={() => (injectOn ? deactivate() : activate())}
            className={cn(
              "h-8 rounded-lg px-4 text-xs font-semibold transition-colors",
              injectOn
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-surface-2 border border-border text-text-muted hover:text-text-main"
            )}
            disabled={sending || !acknowledged}
          >
            {injectOn ? translate("ON") : translate("OFF")}
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="h-8 rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold text-text-main transition-colors hover:bg-surface"
          >
            <span className="material-symbols-outlined text-[16px] align-middle">
              {open ? "expand_less" : "expand_more"}
            </span>{" "}
            {open ? translate("Close") : translate("Configure payload")}
          </button>
        </div>

        {open && (
          <div className="flex flex-col gap-3 border-t border-border p-3">
            <div
              className={cn(
                "flex flex-col gap-4 w-full",
                !acknowledged && "pointer-events-none select-none opacity-40"
              )}
              aria-disabled={!acknowledged}
            >
              {/* ① Skill selection */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">
                    {translate("① Skill selection")}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {translate("Pick the skills the router indexes — or take all")}
                  </span>
                </header>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSkillMenuOpen((v) => !v)}
                    aria-expanded={skillMenuOpen}
                    className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-main transition-colors hover:bg-surface-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">checklist</span>
                    {includeAll
                      ? `${translate("All skills")} (${STRIX_FLAT.length})`
                      : selectedSkillIds.length
                        ? `${selectedSkillIds.length} / ${STRIX_FLAT.length} ${translate("selected")}`
                        : translate("Select skills")}
                    <span className="material-symbols-outlined text-[14px] text-text-muted">
                      {skillMenuOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>
                  {skillMenuOpen && (
                        <div className="w-full max-w-xl rounded-lg border border-border bg-surface">
                          <div className="flex items-center justify-between gap-2 border-b border-border p-2">
                            <label className="flex items-center gap-2 text-[11px] font-medium text-text-main">
                              <input
                                type="checkbox"
                                checked={includeAll || selectedSkillIds.length === STRIX_FLAT.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setIncludeAll(true);
                                    setSelectedSkillIds([]);
                                  } else {
                                    setIncludeAll(false);
                                    setSelectedSkillIds([]);
                                  }
                                }}
                                className="size-4 accent-primary"
                              />
                              {translate("All skills")} ({STRIX_FLAT.length})
                            </label>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setIncludeAll(false);
                                  setSelectedSkillIds(STRIX_FLAT.map((s) => s.id));
                                }}
                                className="rounded px-2 py-1 text-[10px] font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                              >
                                {translate("Select all")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIncludeAll(false);
                                  setSelectedSkillIds([]);
                                }}
                                className="rounded px-2 py-1 text-[10px] font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                              >
                                {translate("Clear")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSkillMenuOpen(false)}
                                className="material-symbols-outlined text-[16px] text-text-muted hover:text-text-main"
                                aria-label={translate("Close")}
                              >
                                close
                              </button>
                            </div>
                          </div>
                          <div className="max-h-72 overflow-y-auto p-2">
                            {STRIX_CATEGORIES.map((cat) => {
                              const catItems = STRIX_FLAT.filter((s) => s.cat === cat.key);
                              const selInCat = catItems.filter((s) =>
                                selectedSkillIds.includes(s.id)
                              ).length;
                              const isCatOpen = openCats[cat.key] ?? false;
                              const toggleCat = (key, next) =>
                                setOpenCats((m) => ({ ...m, [key]: next }));
                              const allInCatSelected = selInCat === catItems.length;
                              return (
                                <div key={cat.key} className="mb-1 last:mb-0">
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleCat(cat.key, !isCatOpen)}
                                      aria-expanded={isCatOpen}
                                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-[11px] font-semibold text-text-main hover:bg-surface-2"
                                    >
                                      <span className="material-symbols-outlined text-[14px] text-text-muted">
                                        {isCatOpen ? "expand_less" : "chevron_right"}
                                      </span>
                                      <span className="truncate">{cat.label}</span>
                                      <span className="text-[10px] font-normal text-text-muted">
                                        {selInCat}/{catItems.length}
                                      </span>
                                    </button>
                                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 px-1.5 py-1.5 text-[11px] text-text-main">
                                      <input
                                        type="checkbox"
                                        checked={allInCatSelected && catItems.length > 0}
                                        ref={(el) => {
                                          if (el)
                                            el.indeterminate =
                                              selInCat > 0 && !allInCatSelected;
                                        }}
                                        onChange={(e) => {
                                          setIncludeAll(false);
                                          setSelectedSkillIds((prev) => {
                                            const catIds = catItems.map((s) => s.id);
                                            if (e.target.checked)
                                              return Array.from(
                                                new Set([...prev, ...catIds])
                                              );
                                            return prev.filter(
                                              (id) => !catIds.includes(id)
                                            );
                                          });
                                        }}
                                        className="size-4 accent-primary"
                                        title={
                                              allInCatSelected && catItems.length > 0
                                                ? translate("Clear category")
                                                : translate("Select category")
                                        }
                                      />
                                    </label>
                                  </div>
                                  {isCatOpen && (
                                    <div className="flex flex-col gap-0.5 pb-1 pl-6">
                                      {catItems.map((s) => (
                                        <label
                                          key={s.id}
                                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-text-main hover:bg-surface-2"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selectedSkillIds.includes(s.id)}
                                            onChange={(e) => {
                                              setIncludeAll(false);
                                              setSelectedSkillIds((prev) =>
                                                e.target.checked
                                                  ? [...prev, s.id]
                                                  : prev.filter((id) => id !== s.id)
                                              );
                                            }}
                                            className="size-4 accent-primary"
                                          />
                                          <span className="min-w-0 flex-1 truncate">
                                            {s.name}
                                          </span>
                                          <span className="text-[10px] text-text-muted">
                                            {s.size}
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                </div>
              </section>

              {/* ② Target & scope */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">
                    {translate("② Target & scope")}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {translate("authorized target only — does not change scan results")}
                  </span>
                </header>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={translate("https://target.local or a target description")}
                    className="h-8 min-w-[240px] flex-1 rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  />
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    className="h-8 min-w-[120px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    <option value="">{translate("Scope…")}</option>
                    {SCOPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {/* ③ Skill prompt */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">
                    {translate("③ Skill prompt")}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {translate("copy for external AI agent (Claude, Cursor, …) — same pattern as Skills tab")}
                  </span>
                </header>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main">
                    {skillPrompt ||
                      translate("(set the base URL first — it defaults to window.location.origin)")}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconRight="content_copy"
                    onClick={copySkillPrompt}
                    disabled={!skillPrompt}
                  >
                    {translate("Copy")}
                  </Button>
                </div>
              </section>

              {/* ④ Pointer (what ships) + local index preview */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">
                    {translate("④ Pointer — the only thing that ships into the system prompt")}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {translate("WYSIWYG · edit to override, click away to reset")}
                  </span>
                </header>
                <textarea
                  value={payloadEditing ? payloadText : routerPayload}
                  onChange={(e) => {
                    setPayloadText(e.target.value);
                    setPayloadEditing(true);
                  }}
                  onBlur={() => {
                    if (!payloadText.trim()) setPayloadEditing(false);
                  }}
                  rows={5}
                  spellCheck={false}
                  className={cn(
                    "w-full resize-y rounded-lg border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50",
                    payloadEditing ? "border-amber-500/50" : "border-border"
                  )}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-text-muted">
                    {payloadEditing ? editedText : ""}
                    {!payloadEditing &&
                      `${routerPayload.length.toLocaleString("en-US")} ${translate("chars")} · ≈${estTokens} ${translate("tok")}`}
                  </span>
                  {payloadEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="revert"
                      onClick={() => {
                        setPayloadEditing(false);
                        setPayloadText("");
                      }}
                    >
                      {translate("Reset")}
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-text-muted">
                  {translate(
                    "Local preview only — the full index is served over HTTP, not injected. Read it, copy a skill id, or hand the pointer to an external agent."
                  )}
                </p>
                <details className="rounded-lg border border-border bg-surface/40 p-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-text-main">
                    {translate("Full index (local preview — never injected)")} ·{" "}
                    {fullIndexPreview.length.toLocaleString("en-US")} {translate("chars")} · ≈
                    {fullIndexTokens} {translate("tok")}
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-surface px-2 py-1.5 font-mono text-[10px] text-text-muted">
                    {fullIndexPreview}
                  </pre>
                </details>
              </section>

              {/* Outbound system panel */}
              <div className="rounded-lg border border-border bg-surface-2/50 p-2">
                <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
                  <span className="font-semibold text-text-main">
                    {translate("Outbound system (what ships, in order)")}
                  </span>
                  <span>
                    {translate("skill router")}{" "}
                    {routerPayload.length.toLocaleString("en-US")} {translate("chars")} · ≈{estTokens}{" "}
                    {translate("tok")}
                  </span>
                </div>
                <ol className="space-y-0.5 text-[10px] text-text-muted">
                  <li>
                    <span className="font-semibold text-text-main">
                      {translate("1. Pointer (what ships)")}
                    </span>{" "}
                    — [STRIX-POINTER] one line naming the endpoints (
                    {routerPayload.length.toLocaleString("en-US")}{" "}
                    {translate("chars")})
                  </li>
                  <li>
                    <span className="font-semibold text-text-main">
                      {translate("2. Agent fetch (on demand)")}
                    </span>{" "}
                    — {translate("agent pulls the index, then the 1–3 skills it needs, from")}{" "}
                    <code className="rounded bg-surface px-1 py-0.5">
                      {(baseUrl || "http://localhost:20128")}
                      /api/developer/skill-raw
                    </code>
                  </li>
                  <li className="text-emerald-600 dark:text-emerald-400">
                    <span className="font-semibold">{translate("Not injected")}</span> —{" "}
                    {translate("the full index")} ({fullIndexPreview.length.toLocaleString("en-US")}{" "}
                    {translate("chars")}, ≈{fullIndexTokens}{" "}
                    {translate("tok")}) {translate("stays local — you pay for it only when a skill is actually fetched.")}
                  </li>
                </ol>
                <p className="mt-1 text-[10px] text-text-muted">
                  {translate(
                    "While ON, only the pointer rides every proxied request — Hermes, CLI tools, all clients. The skill text is never inlined into the system prompt, so this costs about 50 tokens per request instead of 2.4k."
                  )}
                </p>
              </div>

              {/* Send state */}
              {sendState.status === "sent" && (
                <Badge variant="success">{sendState.message}</Badge>
              )}
              {sendState.status === "copied" && (
                <Badge variant="primary">{sendState.message}</Badge>
              )}
              {(sendState.status === "error" || sendState.status === "unauthorized") && (
                <Badge variant="error">{sendState.message}</Badge>
              )}
            </div>

            {!acknowledged && (
              <p className="text-[11px] font-medium text-amber-500">
                🔒{" "}
                {translate(
                  "Locked — acknowledge the scope banner above to unlock the SKILL-ROUTER controls."
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
