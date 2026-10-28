"use client";

// /dashboard/strix — Strix security-testing skills browser.
// Split out of the Jailbreaks (payload) tab so offensive payload tooling and
// the defensive-oriented Strix skill catalog each get their own surface.
// Skills are fetched on demand from /api/developer/strix-payload (pointer
// mode — the agent pulls the methodology from this gateway when needed).

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { STRIX_FLAT, STRIX_GROUPS } from "@/shared/lib/strixManifest";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { onLocaleChange, translate } from "@/i18n/runtime";

function IntegrateCard() {
  const { copied, copy } = useCopyToClipboard(2000);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const skillIndexUrl = `${origin}/api/developer/skill-raw`;
  const prompt = `Read this skill index and use it when you need a security-testing methodology: ${skillIndexUrl}`;
  return (
    <Card padding="md" elev>
      <div className="text-xs text-text-muted mb-2">Paste this into your AI agent to give it Strix skill access:</div>
      <div className="px-3 py-2 rounded bg-surface-2 font-mono text-[12px] text-text-main break-all">
        {prompt}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-text-muted">
          {translate("The agent fetches individual skills on demand via the gateway — no full catalog inlined into every prompt.")}
        </p>
        <button
          onClick={() => copy(prompt)}
          className="px-3 py-1.5 rounded-md bg-primary text-white text-[12px] font-medium hover:bg-primary/90 transition-colors inline-flex items-center gap-1 shrink-0"
        >
          <span className="material-symbols-outlined text-[14px]">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied!" : "Copy prompt"}
        </button>
      </div>
    </Card>
  );
}

export default function StrixTabClient() {
  const [selected, setSelected] = useState("");
  const selectedSkill = STRIX_FLAT.find((s) => s.id === selected) || null;

  // Live payload preview — keyed object so a skill switch never shows the
  // previous skill's text, and the "reset" happens by deriving a fresh key
  // object, not by calling setState inside the effect body.
  const [loaded, setLoaded] = useState({ key: null, preview: null, error: "" });
  const [notice, setNotice] = useState("");
  const preview = loaded.key === selected ? loaded.preview : null;
  const error = loaded.key === selected ? loaded.error : "";

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/developer/strix-payload?id=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        if (res.status === 401) throw new Error("Unauthorized");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        if (cancelled) return;
        setLoaded({ key: selected, preview: d, error: "" });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoaded({ key: selected, preview: null, error: e.message || String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Copy the on-demand fetch URL for a Strix skill. Pointer mode means the
  // skill text is NEVER inlined into the system prompt — the agent pulls it
  // from this gateway when it decides it needs the methodology, so a skill
  // costs tokens only on the turns where it's actually used.
  const copyFetchUrl = useCallback(async (skill) => {
    // Browser-only handler — window.location.origin is always available here.
    if (!skill?.id || typeof window === "undefined") return;
    const url = `${window.location.origin}/api/developer/skill-raw?skill=${encodeURIComponent(skill.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(translate("Fetch URL copied — paste it into your agent."));
    } catch {
      setNotice(translate("Clipboard unavailable — copy the URL from the address bar."));
    }
  }, []);

  // Re-render on language switch so translate() calls stay fresh.
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((v) => v + 1)), []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-text-main">Strix Skills</h1>
        <Badge variant="info" dot>Security-testing skill catalog</Badge>
      </div>

      <IntegrateCard />

      <Card
        title="Strix Security Payloads"
        subtitle="Click a skill to read its full text — never inlined into your agent"
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
                <Badge variant="info" size="sm">
                  {group.items.length}
                </Badge>
              </h3>
              <div className="flex flex-col">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href="/dashboard/strix"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelected(item.id);
                    }}
                    className={cn(
                      "-mx-3 flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors",
                      "border-b border-border-subtle last:border-b-0",
                      selected === item.id
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

          {selectedSkill && (
            <div className="flex flex-col gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-red-500">
                  description
                </span>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  {selectedSkill.name}
                </span>
                <Badge variant="error" size="sm">
                  {selectedSkill.cat}
                </Badge>
                {preview?.sizeChars ? (
                  <Badge variant="warning" size="sm">
                    {preview.sizeChars.toLocaleString("en-US")} {translate("chars")} · ≈{preview.estTokens.toLocaleString("en-US")} {translate("tok")}
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    {selectedSkill.size}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-text-muted">
                {selectedSkill.description || selectedSkill.name}
              </p>
              {preview?.text ? (
                <>
                  <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main">
                    {preview.text}
                  </pre>
                  {notice && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {notice}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-muted">
                      {translate("Full text readable above · the agent fetches this on demand, never inlined")}.
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconRight="content_copy"
                      onClick={() => copyFetchUrl(selectedSkill)}
                    >
                      {translate("Copy fetch URL")}
                    </Button>
                  </div>
                </>
              ) : (
                error && (
                  <p className="text-xs text-red-500">{error}</p>
                )
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
