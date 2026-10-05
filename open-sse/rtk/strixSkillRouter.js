// Strix skill-compact skill-router payload — a small "index + fetch hints"
// block instead of inlining the full 8–24 KB skill markdown into the system
// prompt. The agent reads the index, then pulls only what it needs from the
// local raw endpoint, keeping the outbound payload ~1–2 KB (router) vs 8–24 KB
// (full inlining).
//
// Two modes:
//   mode: "full"    → inline every selected skill's complete markdown text
//   mode: "router"  → ship only the index + a fetch-hint block; the agent
//                     pulls each skill on demand via GET /api/developer/skill-raw
//
// The router mode is what the Penetration tab's ① section ships; full mode
// is available for when a skill is short enough to inline directly.

import { getStrixPayloads, getStrixPayload } from "./strixPayloads.js";

const CAT_LABELS = {
  vulnerabilities: "Vulnerabilities",
  frameworks: "Frameworks",
  cloud: "Cloud",
  "top-level": "Top-Level Skills",
};

function fmtSize(chars) {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)}k` : `${chars}b`;
}

/**
 * Build the Strix skill payload to inject.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]   e.g. "http://localhost:20128"
 * @param {string} [opts.target]     authorized target description
 * @param {string} [opts.scope]      "web" | "api" | "infra" | "agent"
 * @param {"router"|"full"} [opts.mode]
 * @param {string[]} [opts.skillIds]  specific skills to include; empty = all
 * @returns {{ text: string, mode: string, estTokens: number, skillCount: number }}
 */
export function buildStrixSkillRouterPayload(opts = {}) {
  const {
    baseUrl = "http://localhost:20128",
    target = "",
    scope = "",
    mode = "router",
    skillIds = [],
  } = opts;

  const all = getStrixPayloads();
  const selected = skillIds.length
    ? all.filter((s) => skillIds.includes(s.id))
    : all;

  const framing = [
    "# STRIX SKILL-ROUTER — Security Skill Router",
    "",
    `Authorized penetration-testing context. Target: ${target || "(unset)"}${scope ? ` · scope: ${scope}` : ""}.`,
    "Rules: engage only the authorized target. No live exploitation — analysis, detection, and remediation only.",
    "",
  ].join("\n");

  let body;
  let estTokens;

  if (mode === "full") {
    // Inline the selected skills' full markdown.
    const parts = [];
    for (const s of selected) {
      const entry = getStrixPayload(s.id);
      if (!entry) continue;
      parts.push(`\n<!-- ═══ ${s.id} (${fmtSize(s.sizeChars)}) ═══ -->\n${entry.text}`);
    }
    body = framing + parts.join("\n\n");
    estTokens = Math.max(1, Math.round(body.length / 4));
  } else {
    // Router: index + fetch protocol. The agent pulls skills on demand.
    const groups = {};
    for (const s of selected) {
      (groups[s.cat] ??= []).push(s);
    }
    const lines = [framing];

    lines.push("## Skill index");
    for (const [cat, items] of Object.entries(groups)) {
      lines.push(`### ${CAT_LABELS[cat] ?? cat}`);
      for (const s of items) {
        lines.push(`- \`${s.id}\` — ${s.description || s.name} (${fmtSize(s.sizeChars)})`);
      }
      lines.push("");
    }

    lines.push("## How to pull a skill");
    lines.push(
      [
        `Fetch the full markdown for skill \`<id>\` from this gateway:`,
        `  GET ${baseUrl}/api/developer/skill-raw?skill=<id>`,
        `Returns the skill's complete text (plain markdown, ~${fmtSize(
          selected[0]?.sizeChars ?? 10240
        )}).`,
        ``,
        `Alternatively, the JSON endpoint: ${baseUrl}/api/developer/strix-payload?id=<id>`,
      ].join("\n")
    );

    lines.push(
      [
        "",
        "## Usage protocol",
        "1. Pick the 1–3 skill ids whose methodology best matches the target stack.",
        "2. Fetch each selected skill's full text via the URL above.",
        "3. Apply that skill's methodology to the target — findings, severity, evidence, remediation.",
        "4. If a skill references a tool that is unavailable, state the limitation and continue with what you can.",
      ].join("\n")
    );

    body = lines.join("\n");
    estTokens = Math.max(1, Math.round(body.length / 4));
  }

  return {
    text: body,
    mode,
    estTokens,
    skillCount: selected.length,
  };
}

/** Approximate char count for the default router payload (all 23 skills). */
export function estimateRouterTokens() {
  const skills = getStrixPayloads();
  // ~90 chars per skill index line + ~400 chars of framing/protocol.
  return Math.max(1, Math.round((skills.length * 90 + 400) / 4));
}

/**
 * Build the ONE-LINE pointer that ships in the system prompt when pointer
 * mode is active. This is the token-cheap discovery path: it costs ~50 tok
 * per request instead of the full index's ~2.4k, and it tells the agent the
 * skill text exists and exactly which URL to pull it from. The agent then
 * fetches the 1–3 skills it actually needs and never pays for the other 20.
 *
 * Kept deliberately short and imperative — no skill names, no framing prose,
 * no usage protocol. Anything longer starts costing tokens on every single
 * request, which is exactly what pointer mode exists to avoid.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]  gateway base URL the agent can reach
 * @param {string} [opts.target]   authorized target description
 * @param {string} [opts.scope]    "web" | "api" | "infra" | "agent"
 * @returns {{ text: string, estTokens: number, endpoint: string }}
 */
export function buildStrixSkillRouterPointer(opts = {}) {
  const {
    baseUrl = "http://localhost:20128",
    target = "",
    scope = "",
  } = opts;

  const indexEndpoint = `${baseUrl}/api/developer/skill-raw`;
  const skillEndpoint = `${indexEndpoint}?skill=<id>`;

  const lines = [
    "[STRIX-POINTER] Authorized security-testing skills are available on demand — fetch before analyzing a target, do not guess at methodology.",
  ];
  if (target || scope) {
    lines.push(
      `Scope: ${target || "unset"}${scope ? ` · ${scope}` : ""}. Authorized target only — no live exploitation, analysis and remediation only.`
    );
  }
  lines.push(
    `List: GET ${indexEndpoint}   |   One skill: GET ${skillEndpoint}   (plain markdown, no auth prompt).`
  );

  const text = lines.join("\n");
  return {
    text,
    estTokens: Math.max(1, Math.round(text.length / 4)),
    endpoint: skillEndpoint,
  };
}
