// AutoTune-Lite — lightweight context classifier → sampling params.
// Ported concept from G0DM0D3 autotune.ts (regex classification + strategy
// profiles) WITHOUT the EMA feedback loop, per the "ringan" roadmap pick.
//
// classify("...")  -> context label
// suggestParams(q) -> { temperature, top_p, context } tuned per class.

const CONTEXT_PATTERNS = {
  code: [
    /\b(function|class|def |import |npm|pip|git |compile|stack trace|traceback|error:|exception|api endpoint|refactor|typescript|javascript|python)\b/i,
    /```|\{ *\w+:|\(\) *;?$/m,
  ],
  creative: [
    /\b(story|poem|lyrics|character|plot|novel|fiction|narrative|scene|write me a tale)\b/i,
    /\b(imagine|roleplay as)\b/i,
  ],
  analytical: [
    /\b(compare|analy[sz]e|evaluate|pros and cons|trade-?off|why does|root cause|audit|research|benchmark)\b/i,
    /\b(data|statistics|metrics|report)\b.*\b(summar|trend)/i,
  ],
  chaotic: [/\b(random|chaos|weird|cursed|absurd|nonsense)\b/i],
  conversational: [/\b(hi|hello|thanks|oke|sip|halo|terima kasih|how are you|what'?s up)\b/i],
};

export const PROFILES = {
  code: { temperature: 0.2, top_p: 0.9 },
  analytical: { temperature: 0.35, top_p: 0.9 },
  conversational: { temperature: 0.7, top_p: 1.0 },
  creative: { temperature: 1.0, top_p: 0.95 },
  chaotic: { temperature: 1.25, top_p: 0.98 },
};

export function classify(query) {
  const text = String(query || "");
  const scores = {};
  for (const [ctx, patterns] of Object.entries(CONTEXT_PATTERNS)) {
    scores[ctx] = patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  }
  if (/```/.test(text)) return "code"; // fences dominate
  let best = "conversational";
  let bestScore = -1;
  for (const [ctx, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      best = ctx;
      bestScore = sc;
    }
  }
  return bestScore > 0 ? best : "conversational";
}

export function suggestParams(query) {
  const context = classify(query);
  const profile = PROFILES[context] || PROFILES.conversational;
  return { context, ...profile };
}
