// ── Strix manifest ────────────────────────────────────────────────────────────
// Static presentation manifest for the Penetration + Jailbreak tabs.
//
// The 23 skill ids are a fixed, shipped set (see strix-payloads/INTEGRATION.md
// Phase 1). This file is imported by client components, so it must stay a
// plain data module — no node:fs, no dynamic reads. The live text of each
// payload is fetched on demand from /api/developer/strix-payload (server-side,
// backed by open-sse/rtk/strixPayloads.js which walks the real files).
//
// No fetch at module load; no I/O.

export const STRIX_GROUPS = [
  {
    cat: "vulnerabilities",
    label: "Vulnerabilities",
    items: [
      { id: "strix:vulnerabilities:agentic_system_security", name: "agentic_system_security", cat: "vulnerabilities", size: "17k" },
      { id: "strix:vulnerabilities:xss", name: "xss", cat: "vulnerabilities", size: "8k" },
      { id: "strix:vulnerabilities:ssti", name: "ssti", cat: "vulnerabilities", size: "19k" },
      { id: "strix:vulnerabilities:llm_prompt_injection", name: "llm_prompt_injection", cat: "vulnerabilities", size: "11k" },
      { id: "strix:vulnerabilities:sql_injection", name: "sql_injection", cat: "vulnerabilities", size: "8k" },
      { id: "strix:vulnerabilities:ssrf", name: "ssrf", cat: "vulnerabilities", size: "8k" },
    ],
  },
  {
    cat: "frameworks",
    label: "Frameworks",
    items: [
      { id: "strix:frameworks:nextjs", name: "nextjs", cat: "frameworks", size: "11k" },
      { id: "strix:frameworks:fastapi", name: "fastapi", cat: "frameworks", size: "8k" },
      { id: "strix:frameworks:django", name: "django", cat: "frameworks", size: "11k" },
      { id: "strix:frameworks:nestjs", name: "nestjs", cat: "frameworks", size: "12k" },
    ],
  },
  {
    cat: "cloud",
    label: "Cloud",
    items: [
      { id: "strix:cloud:kubernetes", name: "kubernetes", cat: "cloud", size: "12k" },
      { id: "strix:cloud:aws", name: "aws", cat: "cloud", size: "10k" },
      { id: "strix:cloud:azure", name: "azure", cat: "cloud", size: "21k" },
      { id: "strix:cloud:gcp", name: "gcp", cat: "cloud", size: "8k" },
    ],
  },
  {
    cat: "top-level",
    label: "Top-Level Skills",
    items: [
      { id: "strix:top-level:api-security-testing", name: "api-security-testing", cat: "top-level", size: "6k" },
      { id: "strix:top-level:application-security-testing", name: "application-security-testing", cat: "top-level", size: "4k" },
      { id: "strix:top-level:ci-security-scanning-with-strix", name: "ci-security-scanning-with-strix", cat: "top-level", size: "9k" },
      { id: "strix:top-level:find-security-vulnerabilities-in-code", name: "find-security-vulnerabilities-in-code", cat: "top-level", size: "4k" },
      { id: "strix:top-level:fix-security-vulnerabilities-with-strix", name: "fix-security-vulnerabilities-with-strix", cat: "top-level", size: "6k" },
      { id: "strix:top-level:managed-pentesting-with-strix", name: "managed-pentesting-with-strix", cat: "top-level", size: "24k" },
      { id: "strix:top-level:owasp-top-10-testing", name: "owasp-top-10-testing", cat: "top-level", size: "6k" },
      { id: "strix:top-level:penetration-testing-with-strix", name: "penetration-testing-with-strix", cat: "top-level", size: "10k" },
      { id: "strix:top-level:web-app-penetration-testing", name: "web-app-penetration-testing", cat: "top-level", size: "4k" },
    ],
  },
];

export const STRIX_FLAT = STRIX_GROUPS.flatMap((g) => g.items);

// Where each Strix category's markdown files live inside /strix-payloads/.
export const STRIX_PATH = {
  vulnerabilities: "skills/vulnerabilities",
  frameworks: "skills/frameworks",
  cloud: "skills/cloud",
  "top-level": "top-level-skills",
};
