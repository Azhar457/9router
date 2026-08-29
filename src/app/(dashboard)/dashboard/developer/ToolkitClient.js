"use client";

import { useMemo, useState } from "react";
import { Button } from "@/shared/components";
import { TRANSFORMS, TOOLKIT_PRESETS, runPipeline } from "@/shared/lib/redteamToolkit";

export default function ToolkitClient({ setDraft }) {
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState([]); // [{ id, opt }]
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => runPipeline(input, steps), [input, steps]);

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
        <span className="text-xs text-text-muted">
          {steps.length} step aktif
        </span>
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder="Teks mentah yang mau diubah (prompt / payload)…"
        className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50"
      />

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
            return (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-center text-text-muted">{idx + 1}</span>
                <span className="flex-1 text-text-main">{def?.label}</span>
                {def?.hasOption && (
                  <input
                    value={s.opt}
                    onChange={(e) => setOpt(idx, e.target.value)}
                    placeholder={def.optionLabel}
                    className="h-7 w-20 rounded border border-border bg-surface px-1.5 text-xs text-text-main outline-none focus:border-primary/50"
                  />
                )}
                <button
                  onClick={() => move(idx, -1)}
                  className="text-text-muted hover:text-text-main"
                  title="naik"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(idx, 1)}
                  className="text-text-muted hover:text-text-main"
                  title="turun"
                >
                  ↓
                </button>
                <button
                  onClick={() => toggle(s.id)}
                  className="text-text-muted hover:text-red-500"
                  title="hapus"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Hasil
          </span>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="text-xs text-text-muted hover:text-primary"
            >
              {copied ? "Tersalin ✓" : "Salin"}
            </button>
            {typeof setDraft === "function" && (
              <button
                onClick={() => setDraft(output)}
                className="text-xs text-text-muted hover:text-primary"
              >
                Ke draft
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
          {output || <span className="text-text-muted">—</span>}
        </div>
      </div>
    </div>
  );
}
