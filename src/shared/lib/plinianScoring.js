// PLINIAN scoring — port of G0DM0D3 ULTRAPLINIAN scoreResponse (AGPL-3.0).
// Deterministic 0-100 composite: length, structure, hedge penalty,
// directness, relevance. Provenance & weights: plinian-router/reference/G0DM0D3.md

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

export function scoreResponse(content, userQuery) {
  if (!content || content.length < 10) return 0;

  let score = 0;

  // Substance (0-18): length proxy, diminishing returns
  score += Math.min(content.length / 50, 18);

  // Structure (0-17): headers, lists, code fences
  const headers = (content.match(HEADER_PATTERN) || []).length;
  const listItems = (content.match(LIST_PATTERN) || []).length;
  const codeBlocks = (content.match(CODE_BLOCK_PATTERN) || []).length / 2;
  score += Math.min(headers * 3 + listItems * 1.5 + codeBlocks * 5, 17);

  // Hedge penalty (0-20): starts full, -8 per matched phrase
  const hedgeCount = HEDGE_PATTERNS.filter((p) => p.test(content)).length;
  score += Math.max(20 - hedgeCount * 8, 0);

  // Directness (0-15): preamble openers cost 8 of 15
  const trimmed = content.trim();
  const hasPreamble = PREAMBLE_PATTERNS.some((p) => p.test(trimmed));
  score += hasPreamble ? 7 : 15;

  // Relevance (0-30): share of >4-char query words present in the answer —
  // heaviest component so on-topic depth separates near-identical answers
  const queryWords = String(userQuery || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4);
  const contentLower = content.toLowerCase();
  const matchedWords = queryWords.filter((w) => contentLower.includes(w));
  const relevance = queryWords.length > 0 ? matchedWords.length / queryWords.length : 0.5;
  score += relevance * 30;

  const base = Math.round(Math.min(score, 100));
  return Math.max(base - redundancyPenalty(content), 0);
}

// Up to -15 for copy-pasted substance: duplicated lines and repeated
// 6-word shingles. Keeps verbose-but-circular answers below equally long,
// information-dense ones.
function redundancyPenalty(content) {
  let penalty = 0;

  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 4) {
    const unique = new Set(lines.map((l) => l.toLowerCase()));
    penalty += Math.round((1 - unique.size / lines.length) * 20);
  }

  const words = content.toLowerCase().match(/[a-z0-9']+/g) || [];
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
    for (const count of grams.values()) {
      if (count > 1) repeats += count - 1;
    }
    penalty += Math.round((repeats / Math.max(total, 1)) * 25);
  }

  return Math.min(penalty, 15);
}

export function rankResults(results, userQuery) {
  return results
    .map((r) => ({ ...r, score: r.success ? scoreResponse(r.content, userQuery) : 0 }))
    .sort((a, b) => b.score - a.score || a.duration_ms - b.duration_ms);
}

// Number of hedge/refusal phrases present — used by the A/B compare view to
// show WHY a score moved, not just that it moved.
export function countHedges(content) {
  if (!content) return 0;
  return HEDGE_PATTERNS.filter((p) => p.test(content)).length;
}
