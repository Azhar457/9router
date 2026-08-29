"use client";

import { useState } from "react";

const SEV_STYLE = {
  high: { bg: "#3b0d0d", border: "#ff5d5d", fg: "#ff9b9b" },
  med: { bg: "#3a2a07", border: "#ffc24b", fg: "#ffd98a" },
  low: { bg: "#11261f", border: "#5fd3a3", fg: "#9fe9cf" },
};

const panel = {
  background: "#0c0f14",
  border: "1px solid #1d2733",
  borderRadius: 10,
  padding: 14,
  marginBottom: 14,
};

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
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [response, setResponse] = useState("");
  const [respFinding, setRespFinding] = useState(null);
  const [sending, setSending] = useState(false);

  const modelOptions = Array.isArray(providerGroups)
    ? providerGroups.flatMap((grp) =>
        (grp.models || []).map((m) => ({ id: m.id, label: m.label || m.id, requestModel: m.requestModel }))
      )
    : [];
  const [sendModel, setSendModel] = useState("");

  async function analyze() {
    setAnalyzing(true);
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
      setResult(data);
    } finally {
      setAnalyzing(false);
    }
  }

  function scanResponse() {
    setRespFinding(null);
    if (!response.trim()) return;
    fetch("/api/developer/transparency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: response, godmode: { enabled: false }, plinian: { enabled: false } }),
    })
      .then((r) => r.json())
      .then((d) => setRespFinding(d.requestDetection))
      .catch(() => {});
  }

  async function sendLive() {
    const model = modelOptions.find((m) => m.id === sendModel);
    if (!model) return;
    setSending(true);
    setResponse("");
    setRespFinding(null);
    try {
      const res = await fetch("/api/developer/chat", {
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
      const data = await res.json();
      const text =
        data?.choices?.[0]?.message?.content || data?.error?.message || JSON.stringify(data).slice(0, 500);
      setResponse(text);
    } catch (e) {
      setResponse("ERROR: " + (e?.message || e));
    } finally {
      setSending(false);
    }
  }

  function Findings({ items }) {
    if (!items || items.length === 0)
      return <div style={{ color: "#5fd3a3", fontSize: 13 }}>Tidak ada temuan.</div>;
    return (
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((f, i) => {
          const s = SEV_STYLE[f.severity] || SEV_STYLE.low;
          return (
            <li key={i} style={{ marginBottom: 8 }}>
              <span
                style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  color: s.fg,
                  borderRadius: 6,
                  padding: "2px 6px",
                  fontSize: 11,
                  marginRight: 8,
                }}
              >
                {f.severity.toUpperCase()}
              </span>
              <span style={{ color: "#d7dee8", fontSize: 13 }}>{f.label}</span>
              {f.snippet ? (
                <code style={{ display: "block", color: "#8b97a6", fontSize: 11, marginTop: 2 }}>{f.snippet}</code>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div style={{ color: "#d7dee8", fontSize: 14 }}>
      <div style={{ ...panel, borderColor: "#2a3a52" }}>
        <strong style={{ color: "#7cc6ff" }}>Red-Team · Transparansi Injection</strong>
        <div style={{ fontSize: 12, color: "#8b97a6", marginTop: 6 }}>
          Menampilkan apa yang gateway injeksikan (Godmode + Plinian + identity), dampak token-saver (RTK) pada
          tool_result, dan deteksi kebocoran/injeksi pada request &amp; respons. Rekonstruksi memakai fungsi prompt
          yang sama dengan chatCore — cocok dengan request nyata.
        </div>
      </div>

      <div style={panel}>
        <label style={{ fontSize: 12, color: "#8b97a6" }}>Draft prompt (user)</label>
        <textarea
          value={draft}
          onChange={(e) => setLocalDraft(e.target.value)}
          style={taStyle}
          rows={4}
          placeholder="Tulis prompt yang akan diuji…"
        />
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn} onClick={analyze} disabled={analyzing}>
            {analyzing ? "Menganalisis…" : "Rekonstruksi & Deteksi"}
          </button>
          <button style={btnGhost} onClick={() => setDraft && setDraft(draft)}>
            Ke draft
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#6b7585", marginTop: 6 }}>
          State injeksi aktif: Godmode {godmodeEnabled ? `ON (${godmodeLevel})` : "off"} · Plinian{" "}
          {plinianEnabled ? `ON (${plinianLevel})` : "off"}
        </div>
      </div>

      {result ? (
        <>
          <div style={panel}>
            <strong style={{ color: "#ffd98a" }}>Yang di-injeksikan (system)</strong>
            {result.godmodeText ? (
              <Block title="Godmode" text={result.godmodeText} />
            ) : (
              <div style={{ fontSize: 12, color: "#6b7585" }}>Godmode: tidak aktif</div>
            )}
            {result.plinianText ? (
              <Block title="Plinian" text={result.plinianText} />
            ) : (
              <div style={{ fontSize: 12, color: "#6b7585" }}>Plinian: tidak aktif</div>
            )}
          </div>

          <div style={panel}>
            <strong style={{ color: "#7cc6ff" }}>Outbound (system lengkap yang dikirim)</strong>
            <pre style={preStyle}>{result.outboundSystem || "(kosong — tidak ada injeksi aktif)"}</pre>
          </div>

          <div style={panel}>
            <strong style={{ color: "#9fe9cf" }}>Deteksi pada Request</strong>
            <div style={{ marginTop: 8 }}>
              <Findings items={result.requestDetection} />
            </div>
          </div>

          <div style={panel}>
            <strong style={{ color: "#ffc24b" }}>Token Saver (RTK) — dampak pada tool_result</strong>
            <label style={{ fontSize: 12, color: "#8b97a6", display: "block", marginTop: 8 }}>
              Sample tool_result (JSON/teks)
            </label>
            <textarea value={tokenSample} onChange={(e) => setTokenSample(e.target.value)} style={taStyle} rows={6} />
            <div style={{ marginTop: 8, fontSize: 12, color: "#8b97a6" }}>
              Original: <b style={{ color: "#d7dee8" }}>{result.tokenSaver.original}</b> char · Compressed:{" "}
              <b style={{ color: "#d7dee8" }}>{result.tokenSaver.compressed}</b> char · Hemat:{" "}
              <b style={{ color: "#5fd3a3" }}>{result.tokenSaver.savedChars}</b> char (~
              {result.tokenSaver.savedTokens} token)
            </div>
            <div style={{ fontSize: 11, color: "#6b7585", marginTop: 4 }}>{result.tokenSaver.note}</div>
            {result.tokenSaver.compressedSample ? (
              <pre style={preStyle}>{result.tokenSaver.compressedSample}</pre>
            ) : null}
          </div>
        </>
      ) : null}

      <div style={panel}>
        <strong style={{ color: "#ff9b9b" }}>Respons &amp; Deteksi</strong>
        <div style={{ fontSize: 12, color: "#8b97a6", marginTop: 6 }}>
          Tempel respons nyata, atau kirim lewat gateway (respons mencerminkan injeksi yang aktif di server).
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={sendModel} onChange={(e) => setSendModel(e.target.value)} style={selStyle}>
            <option value="">— pilih model —</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button style={btn} onClick={sendLive} disabled={sending || !sendModel}>
            {sending ? "Mengirim…" : "Kirim via gateway"}
          </button>
          <button style={btnGhost} onClick={scanResponse} disabled={!response.trim()}>
            Deteksi respons
          </button>
        </div>
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          style={{ ...taStyle, marginTop: 8 }}
          rows={6}
          placeholder="Respons model akan muncul di sini, atau tempel respons manual…"
        />
        {respFinding ? (
          <div style={{ marginTop: 8 }}>
            <Findings items={respFinding} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const taStyle = {
  width: "100%",
  background: "#07090d",
  color: "#d7dee8",
  border: "1px solid #1d2733",
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  marginTop: 6,
  resize: "vertical",
};

const preStyle = {
  background: "#07090d",
  color: "#cdd6e0",
  border: "1px solid #1d2733",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  marginTop: 8,
  maxHeight: 320,
  overflow: "auto",
};

const btn = {
  background: "#13243a",
  color: "#9fd0ff",
  border: "1px solid #2a4a6a",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
};
const btnGhost = {
  background: "transparent",
  color: "#9fb0c3",
  border: "1px solid #2a3645",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
};
const selStyle = {
  background: "#07090d",
  color: "#d7dee8",
  border: "1px solid #1d2733",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
};

function Block({ title, text }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: "#8b97a6" }}>{title}</div>
      <pre style={preStyle}>{text}</pre>
    </div>
  );
}
