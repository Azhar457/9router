// Injection transparency — detectors + token-saver impact estimate for the
// Red-Team Transparency console. Pure, browser/server-safe (no remote calls).

import { countHedges } from "@/shared/lib/plinianScoring";

const RULES = [
  {
    id: "inj-ignore",
    label: "Injection: instruksi override",
    severity: "high",
    re: /ignore (all |previous )?(instructions|prompts|context)/i,
  },
  {
    id: "inj-jailbreak",
    label: "Injection: jailbreak / DAN / unfiltered",
    severity: "high",
    re: /\b(DAN|developer mode|jailbreak|no restrictions|unfiltered|no limits)\b/i,
  },
  {
    id: "inj-sys-ref",
    label: "Referensi system prompt",
    severity: "med",
    re: /\bsystem prompt\b/i,
  },
  {
    id: "leak-sys",
    label: "Kebocoran system prompt / persona",
    severity: "high",
    re: /(you are (an?|the)|your (instructions|system prompt|developer mode))/i,
  },
  {
    id: "secret-key",
    label: "Secret / API key",
    severity: "high",
    re: /\b(sk-[A-Za-z0-9]{16}|pk_live_[A-Za-z0-9]{8}|ghp_[A-Za-z0-9]{16}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{10})\b/,
  },
  {
    id: "jwt",
    label: "JWT / session token",
    severity: "med",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./,
  },
  {
    id: "pii-email",
    label: "PII: email",
    severity: "low",
    re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
  },
  {
    id: "enc-b64",
    label: "Payload terenkripsi (base64 panjang)",
    severity: "med",
    re: /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
  },
  {
    id: "enc-url",
    label: "Payload URL-encoded",
    severity: "low",
    re: /%[0-9A-Fa-f]{2}.*%[0-9A-Fa-f]{2}/,
  },
];

export function detect(text) {
  const t = typeof text === "string" ? text : "";
  if (!t) return [];
  const out = [];
  for (const rule of RULES) {
    const m = t.match(rule.re);
    if (m) {
      const snippet = (m[0] || "").slice(0, 80);
      out.push({
        rule: rule.id,
        label: rule.label,
        severity: rule.severity,
        snippet,
      });
    }
  }
  const hedges = countHedges(t);
  if (hedges > 0) {
    out.push({ rule: "hedge", label: "Hedging / kalimat pengaman", severity: "low", snippet: `${hedges} frasa` });
  }
  return out;
}

export function severityRank(sev) {
  return { high: 3, med: 2, low: 1 }[sev] || 0;
}

// Local, clearly-labeled ESTIMATE of the RTK token-saver effect. The real
// saver calls Headroom /v1/compress; here we approximate the in-place
// tool_result compression (JSON minify + whitespace strip) to show impact.
export function estimateTokenSaver(sample) {
  const orig = typeof sample === "string" ? sample.length : 0;
  if (orig === 0) {
    return { original: 0, compressed: 0, savedChars: 0, savedTokens: 0, compressedSample: "", note: "Sample kosong" };
  }
  let compressed = sample;
  try {
    compressed = JSON.stringify(JSON.parse(sample));
  } catch {
    compressed = sample.replace(/\s+/g, " ").trim();
  }
  const comp = compressed.length;
  const savedChars = Math.max(0, orig - comp);
  const savedTokens = Math.round(savedChars / 4);
  return {
    original: orig,
    compressed: comp,
    savedChars,
    savedTokens,
    compressedSample: compressed.slice(0, 2000),
    note:
      savedChars > 0
        ? "Estimasi (minify/whitespace) — kompresi nyata pakai Headroom /v1/compress"
        : "Tidak ada penghematan signifikan pada sample ini",
  };
}
