"use client";

import { useMemo, useState } from "react";
import { Button } from "@/shared/components";
import { TRANSFORMS, TOOLKIT_PRESETS } from "@/shared/lib/redteamToolkit";

// Code points that render invisibly (zero-width, joiners, BOM, soft hyphen,
// directional / embed marks). Used by Reveal to make them visible to the operator.
const INVISIBLE_CODEPOINTS = new Set([
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad, 0x200e, 0x200f, 0x202a, 0x202b,
  0x202c, 0x202d, 0x202e, 0x2028, 0x2029,
]);

function isInvisible(ch) {
  return INVISIBLE_CODEPOINTS.has(ch.codePointAt(0));
}

// Visualize text with invisible characters revealed as red markers, plus a
// visible-vs-actual character count (e.g. "Hello" looks 5 but is 6 with a
// leading zero-width).
function Reveal({ text }) {
  const chars = Array.from(text || "");
  const invisible = chars.filter(isInvisible).length;
  const visible = chars.length - invisible;
  return (
    <div>
      <div className="mb-1 text-[11px] text-text-muted">
        Panjang: <span className="text-text-main">{chars.length}</span> code point ·{" "}
        <span className="text-text-main">{visible}</span> terlihat ·{" "}
        <span className={invisible ? "text-red-400" : "text-text-main"}>{invisible}</span> invisible
        {invisible > 0 ? " (ada karakter tak-terlihat)" : ""}
      </div>
      <div className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
        {chars.length === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          chars.map((ch, i) =>
            isInvisible(ch) ? (
              <span
                key={i}
                title={`invisible U+${ch.codePointAt(0).toString(16)}`}
                className="rounded bg-red-400/30 px-0.5 text-red-300"
              >
                ·
              </span>
            ) : (
              <span key={i}>{ch}</span>
            )
          )
        )}
      </div>
    </div>
  );
}

export default function ToolkitClient({ setDraft }) {
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState([]); // [{ id, opt }]
  const [copied, setCopied] = useState(false);

  const isOn = (id) => steps.some((s) => s.id === id);

  const toggle = (id) => {
    setSteps((prev) =>
      isOn(id) ? prev.filter((s) => s.id !== id) : [...prev, { id, opt: "" }]
    );
  };

  const move = (idx, dir) => {
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const setOpt = (idx, val) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, opt: val } : s)));
  };

  // Run the pipeline step by step, recording each intermediate output so the
  // operator can see exactly what every transform produced.
  const stepResults = useMemo(() => {
    const res = [];
    let cur = input;
    for (const s of steps) {
      const def = TRANSFORMS.find((x) => x.id === s.id);
      let after = cur;
      if (def) {
        try {
          after = def.apply(cur, s.opt);
        } catch {
          // fail-open: keep previous value
        }
      }
      res.push({ id: s.id, label: def?.label || s.id, opt: s.opt, after });
      cur = after;
    }
    return res;
  }, [input, steps]);

  const output = stepResults.length ? stepResults[stepResults.length - 1].after : input;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-main">
          Red-Team Toolkit — perangkai transformasi payload
        </span>
        <span className="text-xs text-text-muted">{steps.length} step aktif</span>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder="Teks mentah yang mau diubah (prompt / payload)…"
        className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50"
      />
      <Reveal text={input} />

      <div className="flex flex-wrap gap-1.5">
        {TOOLKIT_PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => setInput(p)}
            className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-muted hover:text-text-main hover:border-primary/50"
            title={p}
          >
            seed {i + 1}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-text-muted">
          Transformasi (klik untuk aktifkan)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRANSFORMS.map((t) => (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isOn(t.id)
                  ? "border-primary bg-primary/10 text-text-main"
                  : "border-border text-text-muted hover:text-text-main"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {steps.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
          <div className="text-xs uppercase tracking-wide text-text-muted">
            Urutan pipeline (atas → bawah)
          </div>
          {steps.map((s, idx) => {
            const def = TRANSFORMS.find((x) => x.id === s.id);
            const preview = (stepResults[idx]?.after || "").slice(0, 90);
            return (
              <div key={s.id} className="flex flex-col gap-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-center text-text-muted">{idx + 1}</span>
                  <span className="flex-1 text-text-main">{def?.label}</span>
                  {def?.hasOption && (
                    <input
                      value={s.opt}
                      onChange={(e) => setOpt(idx, e.target.value)}
                      placeholder={def.optionLabel}
                      className="h-7 w-32 rounded border border-border bg-surface px-1.5 text-xs text-text-main outline-none focus:border-primary/50"
                    />
                  )}
                  <button onClick={() => move(idx, -1)} className="text-text-muted hover:text-text-main" title="naik">
                    ↑
                  </button>
                  <button onClick={() => move(idx, 1)} className="text-text-muted hover:text-text-main" title="turun">
                    ↓
                  </button>
                  <button onClick={() => toggle(s.id)} className="text-text-muted hover:text-red-500" title="hapus">
                    ✕
                  </button>
                </div>
                {def?.hint && <span className="text-[10px] text-text-muted">{def.hint}</span>}
                {preview && (
                  <div className="text-[11px] text-text-muted">Preview:</div>
                )}
                {preview && <Reveal text={preview} />}
              </div>
            );
          })}
        </div>
      )}

      {stepResults.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs uppercase tracking-wide text-text-muted">
            Hasil per langkah
          </div>
          {stepResults.map((r, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-surface/40 p-3">
              <div className="mb-1.5 text-xs text-text-main">
                <span className="text-text-muted">{idx + 1}.</span> {r.label}
                {r.opt ? <span className="text-text-muted"> ({r.opt})</span> : null}
              </div>
              <Reveal text={r.after} />
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-text-muted">Hasil akhir</span>
          <div className="flex gap-2">
            <button onClick={copy} className="text-xs text-text-muted hover:text-primary">
              {copied ? "Tersalin ✓" : "Salin"}
            </button>
            {typeof setDraft === "function" && (
              <button onClick={() => setDraft(output)} className="text-xs text-text-muted hover:text-primary">
                Ke draft
              </button>
            )}
          </div>
        </div>
        <Reveal text={output} />
      </div>
    </div>
  );
}
