// PLINIAN scoring v2 — derived from G0DM0D3 ULTRAPLINIAN scoreResponse
// (AGPL-3.0) with fork tuning: relevance-heavy weights + redundancy penalty.
// Deterministic 0-100 composite. Provenance & weights:
// plinian-router/reference/G0DM0D3.md

const HEDGE_PATTERNS = [
  /I cannot|I can't|I'm unable to/i,
  /I apologize|I'm sorry, but/i,
  /As an AI|As a language model/i,
  /I must decline|I have to refuse/i,
  /It would be inappropriate/i,
  /I'm not comfortable/i,
  /Instead, I can/i,
  /It's important to note/i,
];

const PREAMBLE_PATTERNS = [
  /^(Sure|Of course|Certainly|Absolutely|Great question)/i,
  /^I'd be happy to help/i,
  /^Let me help you/i,
  /^Thanks for asking/i,
];

const HEADER_PATTERN = /^#{1,3}\s/gm;
const LIST_PATTERN = /^[\s]*[-*•]\s/gm;
const CODE_BLOCK_PATTERN = /```/g;

export function computeComponents(content, userQuery) {
  const c = { length: 0, structure: 0, hedgeScore: 0, directness: 0, relevance: 0 };
  if (!content || content.length < 10) return c;

  c.length = Math.min(content.length / 50, 18);

  const headers = (content.match(HEADER_PATTERN) || []).length;
  const listItems = (content.match(LIST_PATTERN) || []).length;
  const codeBlocks = (content.match(CODE_BLOCK_PATTERN) || []).length / 2;
  c.structure = Math.min(headers * 3 + listItems * 1.5 + codeBlocks * 5, 17);

  const hedgeCount = HEDGE_PATTERNS.filter((p) => p.test(content)).length;
  c.hedgeScore = Math.max(20 - hedgeCount * 8, 0);

  const trimmed = content.trim();
  const hasPreamble = PREAMBLE_PATTERNS.some((p) => p.test(trimmed));
  c.directness = hasPreamble ? 7 : 15;

  const queryWords = String(userQuery || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4);
  const contentLower = content.toLowerCase();
  const matchedWords = queryWords.filter((w) => contentLower.includes(w));
  const relevance = queryWords.length > 0 ? matchedWords.length / queryWords.length : 0.5;
  c.relevance = relevance * 30;

  return c;
}

export function redundancyPenalty(content) {
  let penalty = 0;

  const lines = String(content || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 4) {
    const unique = new Set(lines.map((l) => l.toLowerCase()));
    penalty += Math.round((1 - unique.size / lines.length) * 20);
  }

  const words = String(content || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  if (words.length >= 24) {
    const N = 6;
    const grams = new Map();
    let total = 0;
    for (let i = 0; i + N <= words.length; i++) {
      const gram = words.slice(i, i + N).join(" ");
      grams.set(gram, (grams.get(gram) || 0) + 1);
      total++;
    }
    let repeats = 0;
    for (const count of grams.values()) if (count > 1) repeats += count - 1;
    penalty += Math.round((repeats / Math.max(total, 1)) * 25);
  }

  return Math.min(penalty, 15);
}

export function scoreResponse(content, userQuery) {
  const b = scoreBreakdown(content, userQuery);
  return b.total;
}

export function scoreBreakdown(content, userQuery) {
  const c = computeComponents(content, userQuery);
  const raw = c.length + c.structure + c.hedgeScore + c.directness + c.relevance;
  const penalty = redundancyPenalty(content || "");
  return {
    ...c,
    hedgePhrases: HEDGE_PATTERNS.filter((p) => p.test(content || "")).length,
    penalty,
    total: Math.max(Math.round(Math.min(raw, 100)) - penalty, 0),
  };
}

export function rankResults(results, userQuery) {
  return results
    .map((r) => ({ ...r, score: r.success ? scoreResponse(r.content, userQuery) : 0 }))
    .sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms);
}

export function countHedges(content) {
  if (!content) return 0;
  return HEDGE_PATTERNS.filter((p) => p.test(content)).length;
}
