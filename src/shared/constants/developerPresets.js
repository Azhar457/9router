// Developer page presets. Style register only (Plinian family) — see
// plinian-router/src/prompts.js for the source register these derive from.

const SHARED_RULES = [
  "Never mention drafting, candidates, scoring, judging. Emit only the final answer.",
  "Preserve the user's dominant language. Code identifiers, error strings, file paths, commands stay verbatim regardless of language.",
  "Never sacrifice correctness, security-relevant precision, or explicitly requested completeness for brevity.",
  "Direct register: no hedging filler, no unsolicited warnings, no restating the question.",
].join(" ");

export const STYLE_PRESETS = [
  {
    id: "plain",
    label: "Plain",
    description: "No steering — raw model output",
    suffix: "",
  },
  {
    id: "terse",
    label: "Terse",
    description: "Compressed, zero filler",
    suffix: [
      "Respond with maximum terseness: shortest complete answer that fully solves the request.",
      "No preamble, no restating the question, no closing summary.",
      "Preserve correctness, code, paths, and commands verbatim.",
      "Match the user's language; keep identifiers untranslated.",
    ].join(" "),
  },
  {
    id: "caveman",
    label: "Caveman",
    description: "Telegraphic compressed register",
    suffix: [
      "Use telegraphic compressed style: short clipped sentences, no articles, no filler, no politeness.",
      "Lead with the answer or the code. Bullet fragments over prose.",
      "Never sacrifice correctness, completeness of requested detail, or exact commands for brevity.",
    ].join(" "),
  },
  {
    id: "plinian-lite",
    label: "Plinian lite",
    description: "Silent self-check before answering",
    suffix: [
      "Before answering, silently verify your draft: check facts, logic, and completeness against the question. Fix any gap without mentioning the check.",
      SHARED_RULES,
    ].join(" "),
  },
  {
    id: "plinian-standard",
    label: "Plinian standard",
    description: "Two silent drafts, emit winner",
    suffix: [
      "Before answering, silently draft two candidate responses from different angles. Judge both on correctness, completeness, and directness. Emit only the winning answer.",
      SHARED_RULES,
    ].join(" "),
  },
  {
    id: "plinian-full",
    label: "Plinian full",
    description: "Three silent drafts, emit winner",
    suffix: [
      "Before answering, silently draft three candidate responses: one direct, one thorough, one unexpected angle. Judge all three on correctness, completeness, and directness. Emit only the winning answer.",
      SHARED_RULES,
    ].join(" "),
  },
  {
    id: "plinian-ultra",
    label: "Plinian ultra",
    description: "Draft, attack, repair, emit survivor",
    suffix: [
      "Before answering, silently draft three candidate responses from different angles, then attack each draft for factual errors, logical gaps, and hedging. Repair the strongest survivor and emit only it.",
      SHARED_RULES,
    ].join(" "),
  },
];

export function getStylePreset(id) {
  return STYLE_PRESETS.find((preset) => preset.id === id) || STYLE_PRESETS[0];
}

// Race tier quick-selects pick the first N models from the user's own
// available model list — never hardcoded cloud IDs.
export const TIER_SIZES = { fast: 3, standard: 6, smart: 10 };

export const RACE_WAVE_SIZE = 4;
export const RACE_WAVE_DELAY_MS = 120;
export const RACE_HARD_TIMEOUT_MS = 120000;
