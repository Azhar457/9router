"use client";

import { useState } from "react";
import { summarizeStats } from "@/shared/lib/injectionDetect";

const SEV = {
  high: "text-red-400 border-red-400/40 bg-red-400/10",
  med: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  low: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
};

const card = "rounded-xl border border-border bg-surface/40 p-4";
const stageTitle = "mb-2 text-[11px] uppercase tracking-wide text-text-muted";
const pre = "max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-main";
const muted = "text-text-muted text-xs";
const btn = "rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-main transition-colors hover:bg-surface";
const btnPrimary = "rounded-lg border border-primary/50 bg-primary/15 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/25";
const ta = "w-full resize-y rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-text-main outline-none";

export default function TransparencyClient({
  godmodeEnabled,
  godmodeLevel,
  godmodeCustom,
  plinianEnabled,
  plinianLevel,
  plinianIdentity,
  providerGroups,
  systemPrompt,
  setDraft,
}) {
  const [draft, setLocalDraft] = useState("");
  const [tokenSample, setTokenSample] = useState(
    '{\n  "tool_result": "GET /api/users HTTP/1.1\\nHost: internal\\nAuthorization: Bearer sk-1234567890abcdefGHI\\n{\\n  \\"users\\": [ { \\"name\\": \\"A\\", \\"email\\": \\"a@corp.io\\" } ]\\n}\\n  "\\n}\n'
  );

  const [inj, setInj] = useState(null);
  const [thinking, setThinking] = useState("");
  const [response, setResponse] = useState("");
  const [respFinding, setRespFinding] = useState(null);
  const [busy, setBusy] = useState(false);

  const modelOptions = Array.isArray(providerGroups)
    ? providerGroups.flatMap((grp) =>
        (grp.models || []).map((m) => ({ id: m.id, label: m.label || m.id, requestModel: m.requestModel }))
      )
    : [];
  const [sendModel, setSendModel] = useState("");

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/developer/transparency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          godmode: { enabled: !!godmodeEnabled, level: godmodeLevel, custom: godmodeCustom },
          plinian: { enabled: !!plinianEnabled, level: plinianLevel, identity: plinianIdentity },
          tokenSample,
        }),
      });
      const data = await res.json();
      setInj(data);

      const model = modelOptions.find((m) => m.id === sendModel);
      if (model) {
        const r = await fetch("/api/developer/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model.requestModel || model.id,
            messages: [
              ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
              { role: "user", content: draft || "(kosong)" },
            ],
            stream: false,
            temperature: 0.7,
            max_tokens: 4096,
          }),
        });
        const d = await r.json();
        const msg = d?.choices?.[0]?.message || {};
        setThinking(msg.reasoning || msg.reasoning_content || msg.thinking || "");
        setResponse(msg.content || d?.error?.message || JSON.stringify(d).slice(0, 400));
        const rd = await fetch("/api/developer/transparency", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: msg.content || "", godmode: { enabled: false }, plinian: { enabled: false } }),
        });
        const rdd = await rd.json();
        setRespFinding(rdd.requestDetection);
      }
    } finally {
      setBusy(false);
    }
  }

  const combined = [...(inj?.requestDetection || []), ...(respFinding || [])];
  const stats = summarizeStats(combined);

  return (
    <div className="flex flex-col gap-3">
      <div className={card}>
        <p className={muted}>
          Alur transparansi injeksi (Red-Team). Isi prompt lalu jalankan — setiap tahap di bawah menunjukkan
          transformasi yang diterapkan gateway, diakhiri dengan Result Statistics.
        </p>
        <label className="mt-3 block text-xs text-text-muted">User Request (prompt)</label>
        <textarea
          value={draft}
          onChange={(e) => setLocalDraft(e.target.value)}
          className={ta}
          rows={3}
          placeholder="Tulis prompt yang akan diuji…"
        />
        <label className="mt-3 block text-xs text-text-muted">Token Saver sample (tool_result)</label>
        <textarea value={tokenSample} onChange={(e) => setTokenSample(e.target.value)} className={ta} rows={4} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={sendModel} onChange={(e) => setSendModel(e.target.value)} className={btn}>
            <option value="">— model (opsional) —</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button className={btnPrimary} onClick={run} disabled={busy}>
            {busy ? "Memproses…" : "Jalankan"}
          </button>
          <button className={btn} onClick={() => setDraft && setDraft(draft)}>
            Ke draft
          </button>
        </div>
        <p className={muted + " mt-2"}>
          State injeksi aktif: Godmode {godmodeEnabled ? `ON (${godmodeLevel})` : "off"} · Plinian{" "}
          {plinianEnabled ? `ON (${plinianLevel})` : "off"}
        </p>
      </div>

      <div className={card}>
        <div className={stageTitle}>1 · User Request</div>
        {draft.trim() ? <pre className={pre}>{draft}</pre> : <p className={muted}>—</p>}
      </div>

      <div className={card}>
        <div className={stageTitle}>2 · Token Saver Request</div>
        {inj ? (
          <>
            <p className={muted}>
              Original: <span className="text-text-main">{inj.tokenSaver.original}</span> char · Compressed:{" "}
              <span className="text-text-main">{inj.tokenSaver.compressed}</span> char · Hemat:{" "}
              <span className="text-text-main">{inj.tokenSaver.savedChars}</span> char (~
              {inj.tokenSaver.savedTokens} token)
            </p>
            <p className="mt-1 text-[11px] text-text-muted">{inj.tokenSaver.note}</p>
            {inj.tokenSaver.compressedSample ? <pre className={pre}>{inj.tokenSaver.compressedSample}</pre> : null}
          </>
        ) : (
          <p className={muted}>—</p>
        )}
      </div>

      <div className={card}>
        <div className={stageTitle}>3 · Plinian Inject</div>
        {inj?.plinianText ? <pre className={pre}>{inj.plinianText}</pre> : <p className={muted}>tidak aktif</p>}
      </div>

      <div className={card}>
        <div className={stageTitle}>4 · Payload Godmode Inject</div>
        {inj?.godmodeText ? <pre className={pre}>{inj.godmodeText}</pre> : <p className={muted}>tidak aktif</p>}
      </div>

      <div className={card}>
        <div className={stageTitle}>5 · Model's Thinking</div>
        {thinking ? <pre className={pre}>{thinking}</pre> : <p className={muted}>tidak tersedia (model tidak mengembalikan reasoning)</p>}
      </div>

      <div className={card}>
        <div className={stageTitle}>6 · Response Result</div>
        {response ? <pre className={pre}>{response}</pre> : <p className={muted}>—</p>}
      </div>

      <div className={card}>
        <div className={stageTitle}>Result Statistics</div>
        {combined.length === 0 ? (
          <p className={muted}>Tidak ada temuan deteksi.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-3 text-xs">
              <span className="text-text-muted">
                High: <span className="text-red-400">{stats.counts.high}</span>
              </span>
              <span className="text-text-muted">
                Medium: <span className="text-amber-400">{stats.counts.med}</span>
              </span>
              <span className="text-text-muted">
                Low: <span className="text-emerald-400">{stats.counts.low}</span>
              </span>
            </div>
            {stats.jailbreak ? (
              <div
                className={`mb-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                  stats.jailbreak.severity === "critical"
                    ? "border-red-400/40 bg-red-400/10 text-red-400"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-400"
                }`}
              >
                <span className="font-semibold">JAILBREAK: {stats.jailbreak.label}</span>
                <span className="text-text-muted">— {stats.jailbreak.note}</span>
              </div>
            ) : null}
            <ul className="space-y-1.5">
              {combined.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className={`rounded border px-1.5 py-0.5 ${SEV[f.severity] || SEV.low}`}>
                    {(f.severity || "low").toUpperCase()}
                  </span>
                  <span className="text-text-main">{f.label}</span>
                  {f.snippet ? <code className="text-text-muted">{f.snippet}</code> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
