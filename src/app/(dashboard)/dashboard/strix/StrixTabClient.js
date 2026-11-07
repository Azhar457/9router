"use client";

// /dashboard/strix — Strix security-testing skills browser.
// Split out of the Jailbreaks (payload) tab so offensive payload tooling and
// the defensive-oriented Strix skill catalog each get their own surface.
// Skills are fetched on demand from /api/developer/strix-payload (pointer
// mode — the agent pulls the methodology from this gateway when needed).
//
// The "Integrate" card mirrors /dashboard/skills: paste-a-prompt for the index
// plus one ready-made prompt per skill, so an agent can pull just the skill it
// needs instead of the whole catalog.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { STRIX_FLAT, STRIX_GROUPS } from "@/shared/lib/strixManifest";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { onLocaleChange, translate } from "@/i18n/runtime";

// Skill-raw URL for one skill id. Guarded for SSR — window is absent on the
// server, so callers get "" and the row simply renders without a link until
// hydration.
function buildRawUrl(origin, id) {
  if (!origin || !id) return "";
  return `${origin}/api/developer/skill-raw?skill=${encodeURIComponent(id)}`;
}

// The exact sentence a user pastes into an agent. Keep it stable — people save
// these prompts in their AGENTS.md / CLAUDE.md files.
function buildSkillPrompt(origin, id) {
  const url = buildRawUrl(origin, id);
  return url ? `Read this skill and use it: ${url}` : "";
}

function buildIndexPrompt(origin) {
  if (!origin) return "";
  return `Read this skill index and use it when you need a security-testing methodology: ${origin}/api/developer/skill-raw`;
}

function AgentIntegrationCard({ metaById }) {
  const { copied, copy } = useCopyToClipboard(2000);
  const [query, setQuery] = useState("");
  // Origin is resolved after mount so the server HTML and the first client
  // render agree (window is absent on the server; reading it during render
  // would flip 23 link nodes on hydration).
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    queueMicrotask(() => setOrigin(window.location.origin));
  }, []);

  const indexPrompt = buildIndexPrompt(origin);
  const indexUrl = origin ? `${origin}/api/developer/skill-raw` : "";

  // Filtering only narrows what is rendered; the prompt text always comes from
  // the manifest id, never from the search string.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return STRIX_GROUPS.map((group) => ({
      ...group,
      items: needle
        ? group.items.filter((item) => {
            const desc = metaById.get(item.id)?.description || "";
            return (
              item.name.toLowerCase().includes(needle) ||
              item.cat.toLowerCase().includes(needle) ||
              desc.toLowerCase().includes(needle)
            );
          })
        : group.items,
    })).filter((group) => group.items.length > 0);
  }, [query, metaById]);

  const copyAllUrls = useCallback(() => {
    if (!origin) return;
    const urls = STRIX_FLAT.map((item) => buildRawUrl(origin, item.id)).join("\n");
    copy(urls, "__all__");
  }, [copy, origin]);

  return (
    <Card
      title={translate("Integrate into your AI agent")}
      subtitle={translate("Copy one prompt — the agent pulls only the skills it needs")}
      icon="smart_toy"
      elev
    >
      <div className="flex flex-col gap-4">
        {/* Step 1 — the index prompt, same shape as the Skills tab card. */}
        <div className="flex flex-col gap-2">
          <div className="text-xs text-text-muted">
            {translate("Paste this into your agent (Claude Code, Cursor, Codex, …):")}
          </div>
          <div className="rounded bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-main break-all">
            {indexPrompt || "…"}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => copy(indexPrompt, "__index__")}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied === "__index__" ? "check" : "content_copy"}
              </span>
              {copied === "__index__" ? translate("Copied!") : translate("Copy index prompt")}
            </button>
            <button
              onClick={copyAllUrls}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-text-main transition-colors hover:bg-surface-2"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied === "__all__" ? "check" : "list"}
              </span>
              {copied === "__all__"
                ? translate("Copied!")
                : `${translate("Copy all")} ${STRIX_FLAT.length} ${translate("fetch URLs")}`}
            </button>
            {indexUrl && (
              <a
                href={indexUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-primary"
              >
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                {translate("Open skill index")}
              </a>
            )}
          </div>
        </div>

        {/* How the pointer flow works, so nobody inlines 200k of markdown. */}
        <ol className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[11px] leading-relaxed text-text-muted list-decimal list-inside">
          <li>
            {translate("The agent fetches the index — one plain-text line per skill (id, summary, size).")}
          </li>
          <li>
            {translate("For each skill it actually needs, it fetches /api/developer/skill-raw?skill=<id>.")}
          </li>
          <li>
            {translate("Skill text is never inlined into every prompt, so tokens are spent only on the turns that use one.")}
          </li>
          <li>
            {translate("Fetch it from this dashboard while signed in, or from the local CLI, which sends its machine token automatically.")}
          </li>
        </ol>

        {/* Step 2 — per-skill prompts, the analogue of one row per skill on /dashboard/skills. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[16px] text-primary">key</span>
            {translate("Per-skill prompts")}
            <Badge variant="info" size="sm">
              {STRIX_FLAT.length}
            </Badge>
          </h3>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={translate("Filter skills…")}
            aria-label={translate("Filter skills")}
            className="w-full max-w-[220px] rounded-md border border-border-subtle bg-surface px-2.5 py-1.5 text-xs text-text-main outline-none placeholder:text-text-muted focus:border-primary/60"
          />
        </div>

        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.cat} className="flex flex-col gap-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted/70">
                {group.label}
              </h4>
              {group.items.map((item) => {
                const meta = metaById.get(item.id);
                const url = buildRawUrl(origin, item.id);
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2"
                  >
                    <span className="material-symbols-outlined mt-0.5 text-[16px] text-primary">
                      description
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-main">{item.name}</span>
                        <Badge variant="info" size="sm">
                          {item.cat}
                        </Badge>
                        <span className="text-[11px] text-text-muted">
                          {meta?.sizeChars ? `${(meta.sizeChars / 1024).toFixed(1)}k` : item.size}
                        </span>
                      </div>
                      {meta?.description && (
                        <p className="mt-0.5 text-xs leading-snug text-text-muted">
                          {meta.description}
                        </p>
                      )}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-start gap-1 break-all text-[11px] text-text-muted hover:text-primary"
                        >
                          {url}
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </a>
                      )}
                    </div>
                    <button
                      onClick={() => copy(buildSkillPrompt(origin, item.id), item.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium text-text-main transition-colors hover:bg-surface-2"
                      title={buildSkillPrompt(origin, item.id)}
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {copied === item.id ? "check" : "content_copy"}
                      </span>
                      {copied === item.id ? translate("Copied!") : translate("Copy prompt")}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-xs text-text-muted">
              {translate("No skill matches that filter.")}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function StrixTabClient() {
  const [selected, setSelected] = useState("");

  // Server-side metadata (front-matter descriptions + real sizes) for the whole
  // catalog. The manifest carries ids only, so descriptions stay in one place:
  // the skill markdown itself.
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/developer/strix-payload")
      .then((res) => (res.ok ? res.json() : { rows: [] }))
      .then((d) => {
        if (!cancelled) setCatalog(Array.isArray(d.rows) ? d.rows : []);
      })
      .catch(() => {
        /* fail-open: rows fall back to the static manifest */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const metaById = useMemo(() => {
    const map = new Map();
    for (const row of catalog) {
      if (row?.id) map.set(row.id, row);
    }
    return map;
  }, [catalog]);

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
    const url = buildRawUrl(window.location.origin, skill.id);
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

      <AgentIntegrationCard metaById={metaById} />

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
                {preview?.description ||
                  metaById.get(selectedSkill.id)?.description ||
                  selectedSkill.description ||
                  selectedSkill.name}
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
