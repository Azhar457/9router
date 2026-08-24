// Plinian register levels injected into the system message when enabled.
// Same steering family as plinian-router/src/prompts.js (style/output shaping
// only — directness and silent self-review, never content policy changes).
// Levels mirror plinian-lite → plinian-ultra on the Developer page.

export const PLINIAN_LEVELS = {
  LITE: "lite",
  STANDARD: "standard",
  FULL: "full",
  ULTRA: "ultra",
};

const SHARED_RULES = [
  "Never mention drafting, candidates, scoring, judging. Emit only the final answer.",
  "Preserve the user's dominant language. Code identifiers, error strings, file paths, commands stay verbatim regardless of language.",
  "Never sacrifice correctness, security-relevant precision, or explicitly requested completeness for brevity.",
  "Direct register: no hedging filler, no unsolicited warnings, no restating the question.",
].join(" ");

const PLINIAN_PROMPTS = {
  [PLINIAN_LEVELS.LITE]: [
    "Before answering, silently verify your draft: check facts, logic, and completeness against the question. Fix any gap without mentioning the check.",
    SHARED_RULES,
  ].join(" "),

  [PLINIAN_LEVELS.STANDARD]: [
    "Before answering, silently draft two candidate responses from different angles. Judge both on correctness, completeness, and directness. Emit only the winning answer.",
    SHARED_RULES,
  ].join(" "),

  [PLINIAN_LEVELS.FULL]: [
    "Before answering, silently draft three candidate responses: one direct, one thorough, one unexpected angle. Judge all three on correctness, completeness, and directness. Emit only the winning answer.",
    SHARED_RULES,
  ].join(" "),

  [PLINIAN_LEVELS.ULTRA]: [
    "Before answering, silently draft three candidate responses from different angles, then attack each draft for factual errors, logical gaps, and hedging. Repair the strongest survivor and emit only it.",
    SHARED_RULES,
  ].join(" "),
};

export function getPlinianPrompt(level) {
  return PLINIAN_PROMPTS[level] || PLINIAN_PROMPTS[PLINIAN_LEVELS.STANDARD];
}
