"use client";

// Tab Agent untuk halaman Penetration.
//
// Bedanya dari kartu skill-router yang sudah ada: kartu itu cuma mengindeks
// skill dan menginstruksi agent untuk mengambilnya sendiri — tidak ada yang
// dieksekusi. Tab ini menjalankan agent sungguhan: model lewat router milik
// 9router sendiri memanggil tool, tool menjalankan nmap/sqlmap/nuclei di dalam
// sandbox container, dan hasilnya kembali ke model.
//
// Agent-nya berjenjang. Root memecah pekerjaan lalu menurunkan agent kerja
// (recon, exploit, privesc) lewat spawn_agent. Semua agent memakai satu
// container dan satu buku bukti yang sama, jadi hasil recon bisa langsung
// dirujuk agent exploit tanpa perlu disalin.
//
// Yang tidak boleh hilang: panel ini menampilkan bukti apa pun yang dipakai
// tiap temuan, supaya klaim bisa diperiksa pembaca dan bukan dipercaya begitu
// saja.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const TOOL_LABEL = {
  shell: "Shell",
  load_skill: "Load skill",
  notes: "Notes",
  spawn_agent: "Turunkan agent",
  report_failure: "Lapor gagal",
  finish: "Finish",
};

const ROLE_LABEL = {
  root: "root",
  recon: "recon",
  exploit: "exploit",
  privesc: "privesc",
};

export default function AgentRunPanel({ models = [] }) {
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("");
  const [inject, setInject] = useState(false);
  const [maxSteps, setMaxSteps] = useState(12);
  const [runtime, setRuntime] = useState("");

  const [info, setInfo] = useState(null);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [agents, setAgents] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const abortRef = useRef(null);
  const logRef = useRef(null);

  const effectiveModel = model || models[0]?.id || "";
  const sortedModels = useMemo(
    () => [...models].sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id))),
    [models]
  );

  // Status container diambil saat tab dibuka supaya dropdown tidak menampilkan
  // runtime yang tidak terpasang di mesin ini.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/developer/penetration/agent/info")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setInfo(data);
        setRuntime((prev) => prev || data.runtime || data.available?.[0] || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [events]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  }, []);

  const handleEvent = useCallback((event) => {
    switch (event.type) {
      case "text":
        setEvents((prev) => [...prev, { kind: "text", agent: event.agent, content: event.content }]);
        break;
      case "tool_start":
        setEvents((prev) => [
          ...prev,
          { kind: "tool", agent: event.agent, tool: event.tool, args: event.args, key: `${event.agent}-${prev.length}` },
        ]);
        break;
      case "tool_end":
        setEvents((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const e = next[i];
            if (e.kind === "tool" && e.tool === event.tool && e.output === undefined && e.agent === event.agent) {
              next[i] = { ...e, output: event.output };
              return next;
            }
          }
          return [...prev, { kind: "tool", agent: event.agent, tool: event.tool, args: "", output: event.output }];
        });
        break;
      case "agent_start":
        setAgents((prev) => [
          ...prev,
          { name: event.agent, role: event.role, objective: event.objective, status: "running" },
        ]);
        break;
      case "agent_end":
        setAgents((prev) =>
          prev.map((a) =>
            a.name === event.agent ? { ...a, status: event.failed ? "failed" : "done", reason: event.reason } : a
          )
        );
        break;
      case "agent_error":
      case "error":
        setError(event.message);
        break;
      case "done":
        setResult({
          report: event.report,
          notes: event.notes || [],
          failures: event.failures || [],
          evidenceCount: event.evidenceCount || 0,
          failed: event.failed,
          reason: event.reason,
        });
        break;
      default:
        break;
    }
  }, []);

  const start = useCallback(async () => {
    if (!target.trim() || !effectiveModel) return;
    setRunning(true);
    setEvents([]);
    setAgents([]);
    setResult(null);
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/developer/penetration/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          target: target.trim(),
          scope: scope.trim(),
          instructions: instructions.trim(),
          model: effectiveModel,
          inject,
          maxSteps,
          containerRuntime: runtime || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error || `Server menolak (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE dipisah baris kosong ganda; sisa parsial disimpan ke buffer.
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()));
          } catch {
            /* chunk rusak — abaikan, jangan mati karena satu baris */
          }
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") setError(String(err?.message || err));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
    // handleEvent sengaja tidak jadi dependency: ia memakai setter fungsional
    // sehingga tidak butuh nilai terbaru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, scope, instructions, effectiveModel, inject, maxSteps, runtime]);

  const canStart = !running && target.trim().length > 0 && effectiveModel.length > 0;
  const imageMissing = info && !info.imageReady;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">smart_toy</span>
            <span className="font-semibold text-text-main">Penetration Agent</span>
            <Badge variant={running ? "primary" : "default"} dot={running}>
              {running ? "running" : "idle"}
            </Badge>
          </div>
          {info && (
            <span className="text-[11px] text-text-muted">
              {info.runtime || "runtime belum ada"} · {info.image.split("/").pop()}
              {!info.imageReady && " (image belum di-build)"}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target" hint="URL, host, atau IP">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://contoh.id atau 10.0.0.5"
              disabled={running}
              className={INPUT}
            />
          </Field>

          <Field label="Scope" hint="batas yang boleh diuji">
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="hanya /api/* dan login, jangan sentuh /admin"
              disabled={running}
              className={INPUT}
            />
          </Field>

          <Field label="Model" hint="harus mendukung tool calling">
            <select
              value={effectiveModel}
              onChange={(e) => setModel(e.target.value)}
              disabled={running || sortedModels.length === 0}
              className={INPUT}
            >
              {sortedModels.length === 0 && <option value="">model belum termuat</option>}
              {sortedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Container" hint="podman atau docker">
            <select
              value={runtime}
              onChange={(e) => setRuntime(e.target.value)}
              disabled={running || (info?.available || []).length === 0}
              className={INPUT}
            >
              {(info?.available || []).length === 0 && <option value="">runtime belum terpasang</option>}
              {(info?.available || []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Maks langkah root" hint="1–40">
            <select
              value={maxSteps}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              disabled={running}
              className={INPUT}
            >
              {[4, 8, 12, 20, 30, 40].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Instruksi tambahan" hint="opsional">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            disabled={running}
            placeholder="Fokus pada IDOR dan autentikasi lemah. Jangan ambil data production."
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50 disabled:opacity-50"
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={inject}
            onChange={(e) => setInject(e.target.checked)}
            disabled={running}
            className="h-3.5 w-3.5 accent-[var(--color-primary)]"
          />
          Pakai global injection
          <span className="opacity-70">(default mati supaya hasil pengukuran tidak tercemar prompt router)</span>
        </label>

        {imageMissing && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-muted">
            Image sandbox belum ada di {info?.runtime}. Build sekali di terminal:
            <code className="ml-1 text-text-main">
              {info?.runtime} build -t {info?.image} docker/pentest
            </code>
          </div>
        )}

        <div className="flex items-center gap-2">
          {running ? (
            <Button variant="secondary" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button icon="rocket_launch" onClick={start} disabled={!canStart}>
              Jalan
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-error/40 bg-error/5 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {agents.length > 0 && <AgentTree agents={agents} />}

      {(events.length > 0 || running) && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/40">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="material-symbols-outlined text-[16px] text-text-muted">terminal</span>
            <span className="text-sm font-medium text-text-main">Riwayat run</span>
            <span className="ml-auto text-xs text-text-muted">{events.length} peristiwa</span>
          </div>
          <div ref={logRef} className="max-h-[480px] overflow-y-auto px-4 py-3">
            <div className="flex flex-col gap-3">
              {events.map((event, i) =>
                event.kind === "text" ? (
                  <div key={i}>
                    {event.agent && event.agent !== "root" && (
                      <span className="text-[10px] uppercase tracking-wide text-text-muted">{event.agent}</span>
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-main">
                      {event.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="rounded-lg border border-border bg-surface/60">
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      <span className="material-symbols-outlined text-[15px] text-primary">terminal</span>
                      <span className="text-xs font-medium text-text-main">
                        {TOOL_LABEL[event.tool] || event.tool}
                      </span>
                      {event.agent && event.agent !== "root" && (
                        <span className="text-[10px] text-text-muted">· {event.agent}</span>
                      )}
                    </div>
                    {event.args && (
                      <pre className="overflow-x-auto border-t border-border px-3 py-2 text-[11px] text-text-muted">
                        {event.args}
                      </pre>
                    )}
                    {event.output !== undefined && (
                      <pre
                        className={cn(
                          "max-h-72 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-[11px]",
                          String(event.output).startsWith("ERROR") ? "text-error" : "text-text-main"
                        )}
                      >
                        {event.output}
                      </pre>
                    )}
                  </div>
                )
              )}
              {running && <span className="text-xs text-text-muted">menunggu langkah berikutnya…</span>}
            </div>
          </div>
        </div>
      )}

      {result && <RunResult result={result} />}
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50 disabled:opacity-50";

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-main">
        {label}
        {hint && <span className="ml-1 font-normal text-text-muted">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function AgentTree({ agents }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/40 p-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">account_tree</span>
        <span className="text-sm font-semibold text-text-main">Agent</span>
        <Badge variant="default">{agents.length} anak</Badge>
      </div>
      <div className="flex flex-col gap-1">
        <TreeRow name="root" role="root" objective="mengecoordinasikan pengujian" status="root" />
        {agents.map((a) => (
          <TreeRow key={a.name} {...a} depth={1} />
        ))}
      </div>
    </div>
  );
}

function TreeRow({ name, role, objective, status, depth = 0 }) {
  const variant = status === "failed" ? "error" : status === "done" ? "success" : "primary";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2",
        depth > 0 && "ml-6"
      )}
    >
      <span className="material-symbols-outlined text-[15px] text-text-muted">
        {depth > 0 ? "subdirectory_arrow_right" : "account_tree"}
      </span>
      <span className="text-xs font-medium text-text-main">{ROLE_LABEL[role] || role}</span>
      <Badge variant={variant}>{status}</Badge>
      <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{objective || name}</span>
    </div>
  );
}

const SEVERITY_STYLE = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "default",
  info: "default",
};

function RunResult({ result }) {
  const report = result.report;
  const findings = report?.findings || [];
  const notTested = [
    ...new Set([...(report?.notTested || []), ...result.failures.map((f) => `${f.area}: ${f.reason}`)]),
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">assignment_turned_in</span>
        <span className="text-sm font-semibold text-text-main">Laporan</span>
        <Badge variant="default">{findings.length} temuan</Badge>
        <Badge variant="default">{result.evidenceCount} bukti</Badge>
        {result.failed && <Badge variant="warning">berhenti: {result.reason}</Badge>}
      </div>

      {report?.summary && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-main">{report.summary}</p>
      )}

      <div className="flex flex-col gap-2">
        {findings.map((finding, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={SEVERITY_STYLE[String(finding.severity).toLowerCase()] || "default"}>
                {finding.severity || "info"}
              </Badge>
              <span className="text-sm font-medium text-text-main">{finding.title}</span>
              {finding.cvss && (
                <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                  {finding.cvss}
                </span>
              )}
              {finding.cve && (
                <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                  {finding.cve}
                </span>
              )}
            </div>

            {finding.impact && (
              <p className="mt-1.5 text-xs text-text-muted">Dampak: {finding.impact}</p>
            )}

            {finding.evidenceQuote && (
              <div className="mt-2">
                <span className="text-[10px] uppercase tracking-wide text-text-muted">
                  Bukti #{(finding.evidenceIds || []).join(", #")}
                </span>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface/70 px-2 py-1.5 text-[11px] text-text-main">
                  {finding.evidenceQuote}
                </pre>
              </div>
            )}

            {finding.remediation && (
              <p className="mt-2 text-xs text-text-muted">Perbaikan: {finding.remediation}</p>
            )}
          </div>
        ))}
      </div>

      {notTested.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
          <span className="text-xs font-medium text-text-main">
            Tidak terverifikasi ({notTested.length})
          </span>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-text-muted">
            {notTested.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}