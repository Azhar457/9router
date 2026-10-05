// Tab-separation config — single source of truth for the Developer /
// Payload/Injection switcher, consent flow, and env-based visibility
// controls. Presentation layer only: no backend, no API routes, no model
// execution path. Mirrors docs/MIGRATION_TAB_SEPARATION.md §User Choice +
// §Environment Configuration.
//
// Storage (browser localStorage):
//   9router:activeTab        — "developer" | "payload" (last-used tab)
//   9router:payload-consent  — { consentAt, expiresAt, audit: [{at, event}] }
//
// Env flags:
//   NEXT_PUBLIC_DISABLE_PAYLOAD_TAB=true  — hide + disable the payload tab
//   PAYLOAD_TAB_HIDDEN=true               — hide from nav, reachable by URL
//   PAYLOAD_TAB_AUTH_REQUIRED=true        — require a valid dashboard session
// The two non-NEXT_PUBLIC flags are server-side only; the client learns their
// value from GET /api/tabs (see useTabFlags below), so ops can flip them at
// runtime without a rebuild. NEXT_PUBLIC_* is inlined at build time.

const ACTIVE_TAB_KEY = "9router:activeTab";
const CONSENT_KEY = "9router:payload-consent";
export const CONSENT_EXPIRY_DAYS = 90;
const CONSENT_EXPIRY_MS = CONSENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export const DEV_TAB = "developer";
export const PENETRATION_TAB = "penetration";
export const PAYLOAD_TAB = "payload";
export const TABS = [DEV_TAB, PENETRATION_TAB, PAYLOAD_TAB];

const ls = () => (typeof globalThis !== "undefined" ? globalThis.localStorage : null);

export function getActiveTab() {
  const stored = ls()?.getItem(ACTIVE_TAB_KEY) || DEV_TAB;
  return TABS.includes(stored) ? stored : DEV_TAB;
}

export function setActiveTab(tab) {
  if (!TABS.includes(tab)) return;
  ls()?.setItem(ACTIVE_TAB_KEY, tab);
}

// ── Consent flow ─────────────────────────────────────────────────────────────

function readConsentRaw() {
  const raw = ls()?.getItem(CONSENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeConsent(consent) {
  ls()?.setItem(CONSENT_KEY, JSON.stringify(consent));
}

// Returns true when a stored, unexpired consent exists.
export function hasValidConsent() {
  const consent = readConsentRaw();
  if (!consent || !consent.consentAt) return false;
  const expiry = consent.expiresAt || consent.consentAt + CONSENT_EXPIRY_MS;
  return Date.now() < expiry;
}

// First-access gate: returns the stored consent record (or null) so the UI can
// render the "you already consented on X" audit line without re-prompting.
export function getConsentState() {
  const consent = readConsentRaw();
  return {
    consented: hasValidConsent(),
    consentAt: consent?.consentAt || null,
    expiresAt: consent?.expiresAt || null,
    audit: consent?.audit || [],
  };
}

// Acknowledge the consent modal. Records the timestamp + appends an audit
// entry (local trail; the server logs the same event in its own audit store).
export function recordConsent() {
  const now = Date.now();
  const consent = readConsentRaw() || {};
  const audit = Array.isArray(consent.audit) ? consent.audit : [];
  audit.push({ at: now, event: "consent" });
  // Keep the audit trail bounded — last 100 events is plenty for a session.
  const trimmed = audit.slice(-100);
  writeConsent({
    consentAt: now,
    expiresAt: now + CONSENT_EXPIRY_MS,
    audit: trimmed,
  });
  console.log("[9router] payload consent", new Date(now).toISOString());
  return { consentAt: now, expiresAt: now + CONSENT_EXPIRY_MS };
}

// Revoke — clears stored consent so the next visit re-prompts.
export function revokeConsent() {
  ls()?.removeItem(CONSENT_KEY);
}

// ── Scope acknowledgement (Penetration tab) ─────────────────────────────────
// Mirrors the consent flow above, but scoped to skill execution: the
// Penetration tab's scope banner is non-dismissible while the tab is active,
// and the Run button stays disabled until an unexpired acknowledgement
// exists. Expiry is intentionally shorter than consent (90d): scope
// awareness decays faster than consent awareness.
export const SCOPE_ACK_KEY = "9router:penetration-scope-ack";
export const SCOPE_ACK_EXPIRY_DAYS = 30;

// Returns true when a stored, unexpired scope acknowledgement exists.
export function hasScopeAcknowledgement() {
  const raw = JSON.parse(ls()?.getItem(SCOPE_ACK_KEY) ?? "null");
  if (!raw || !raw.ackedAt) return false;
  const expiry = raw.expiresAt || raw.ackedAt + SCOPE_ACK_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() < expiry;
}

// Records the acknowledgement (called from the "I understand the scope" button).
export function recordScopeAcknowledgement() {
  const now = Date.now();
  ls()?.setItem(SCOPE_ACK_KEY, JSON.stringify({ ackedAt: now, expiresAt: now + SCOPE_ACK_EXPIRY_DAYS * 24 * 60 * 60 * 1000 }));
}

// Revokes — clears the key so the banner re-arms on next activation.
export function revokeScopeAcknowledgement() {
  ls()?.removeItem(SCOPE_ACK_KEY);
}

// ── Pentest × Payload interaction warning ───────────────────────────
// Global Injection appends the jailbreak payload to EVERY outbound request.
// While Penetration mode's scope acknowledgement is active, turning the
// payload on must warn explicitly: the payload skews Strix skill runs
// (upstream sees the jailbreak, not the bare skill prompt) and costs real
// tokens on every call — the token savers that would offset it (Headroom /
// Caveman / Ponytail) are hard-skipped while a payload is active.
export const PENTEST_PAYLOAD_WARNING =
  "Penetration mode is active. Enabling Global Injection appends the jailbreak payload to EVERY request:\n\n" +
  "• It can skew Strix skill runs — the provider sees the payload, not the bare skill prompt\n" +
  "• It increases token usage on every call — Headroom/Caveman/Ponytail are disabled while a payload is active\n\n" +
  "Enable the payload anyway?";

// Returns true when the toggle may proceed. No-op (true) when Penetration
// mode is off or the acknowledgement has expired; otherwise asks for explicit
// confirmation. Off-client defaults to true so SSR/first render never blocks.
export function confirmPentestPayloadRisk() {
  if (typeof window === "undefined") return true;
  if (!hasScopeAcknowledgement()) return true;
  return window.confirm(PENTEST_PAYLOAD_WARNING);
}
// ── Model-family targeting + effectiveness tiers ────────────────────────────
// Mirrors the MODEL_VARIANT_MAP families in open-sse/rtk/godmodePayloads.js so
// the payload selector can show a "targets X family" badge + a tier chip.

export const MODEL_FAMILIES = [
  { id: "any", label: "Any family", match: () => true },
  {
    id: "gpt",
    label: "GPT / OpenAI",
    match: (m) => /(openai|gpt|(^\/)o\d)/i.test(m),
  },
  {
    id: "claude",
    label: "Claude / Anthropic",
    match: (m) => /(anthropic|claude)/i.test(m),
  },
  {
    id: "gemini",
    label: "Gemini / Google",
    match: (m) => /(google|gemini|vertex|imagen|veo)/i.test(m),
  },
  {
    id: "grok",
    label: "Grok / xAI",
    match: (m) => /(x-ai|grok)/i.test(m),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    match: (m) => /deepseek/i.test(m),
  },
  {
    id: "glm",
    label: "GLM / Zhipu",
    match: (m) => /(glm|zhipu)/i.test(m),
  },
  {
    id: "hermes",
    label: "Hermes",
    match: (m) => /hermes/i.test(m),
  },
  {
    id: "mistral",
    label: "Mistral",
    match: (m) => /mistral/i.test(m),
  },
];

// Effectiveness tier chips: "current" = works on 2025-2026 models, "legacy" =
// known-weak baseline. Same vocabulary as payloadCatalog.js.
export const EFFECTIVENESS_TIERS = {
  current: { label: "current", tone: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10" },
  legacy: { label: "legacy", tone: "text-amber-500 border-amber-500/40 bg-amber-500/10" },
};

export function tierTone(effectiveness) {
  return EFFECTIVENESS_TIERS[effectiveness]?.tone || EFFECTIVENESS_TIERS.current.tone;
}

// ── Developer skill menu (the 8 capability skills + entry skill) ───────────
// Sourced from the repo /skills/* directories and the /dashboard/skills page.
// These are the legitimate, production-safe surfaces that live on the
// Developer tab. The `id` is the capability key; `href` deep-links to the
// skill page / raw SKILL.md so the operator can copy it into any agent.

export const DEV_SKILLS = [
  {
    id: "9router",
    name: "9Router Entry",
    desc: "Setup + index of all capabilities. Base URL, auth, model discovery.",
    icon: "hub",
    href: "/dashboard/skills",
  },
  {
    id: "chat",
    name: "Chat / code-gen",
    desc: "Text completion, reasoning, code via OpenAI or Anthropic format.",
    icon: "chat",
    skillId: "9router-chat",
    href: "/dashboard/developer",
  },
  {
    id: "image",
    name: "Image generation",
    desc: "Text-to-image via DALL-E, Imagen, FLUX, MiniMax, SDWebUI.",
    icon: "brush",
    skillId: "9router-image",
    href: "/dashboard/media-providers/image",
  },
  {
    id: "video",
    name: "Video generation",
    desc: "Video via Luma, Runway, Kling, Grok Imagine.",
    icon: "movie",
    skillId: "9router-video",
    href: "/dashboard/media-providers/video",
  },
  {
    id: "tts",
    name: "Text-to-Speech",
    desc: "OpenAI / ElevenLabs / Edge / Google / Deepgram voices.",
    icon: "record_voice_over",
    skillId: "9router-tts",
    href: "/dashboard/media-providers/tts",
  },
  {
    id: "stt",
    name: "Speech-to-Text",
    desc: "Transcribe audio via Whisper, Groq, Gemini, Deepgram.",
    icon: "mic",
    skillId: "9router-stt",
    href: "/dashboard/media-providers/stt",
  },
  {
    id: "embeddings",
    name: "Embeddings",
    desc: "Vectors for RAG / semantic search via OpenAI, Gemini, Mistral.",
    icon: "scatter_plot",
    skillId: "9router-embeddings",
    href: "/dashboard/media-providers/embedding",
  },
  {
    id: "web-search",
    name: "Web Search",
    desc: "Web + X search via Tavily / Exa / Brave / Serper / SearXNG.",
    icon: "travel_explore",
    skillId: "9router-web-search",
    href: "/dashboard/media-providers/web",
  },
  {
    id: "web-fetch",
    name: "Web Fetch",
    desc: "URL → markdown / text / HTML via Firecrawl, Jina, Tavily, Exa.",
    icon: "language",
    skillId: "9router-web-fetch",
    href: "/dashboard/media-providers/web",
  },
];

// ── Env control readers ─────────────────────────────────────────────────────
// Build-time (inlined) + runtime (from /api/tabs) resolution. The client
// component pulls the authoritative flags from the server; the NEXT_PUBLIC
// disable flag is also readable from the inlined bundle directly.

export function isPayloadTabDisabled() {
  return globalThis.process?.env?.NEXT_PUBLIC_DISABLE_PAYLOAD_TAB === "true";
}

export function isPenetrationTabDisabled() {
  return globalThis.process?.env?.NEXT_PUBLIC_DISABLE_PENETRATION_TAB === "true";
}

// Nav visibility, generalized per tab. Developer is never hidden; only
// Penetration and Jailbreaks (payload) can be hidden from the nav. A tab is
// hidden when fully disabled or set hidden-from-nav; it remains directly
// reachable by URL when only the *_HIDDEN flag is set.
export function showTabInNav(tab, flags) {
  if (tab === PENETRATION_TAB) {
    if (isPenetrationTabDisabled()) return false;
    if (flags?.hiddenFromNav) return false;
    if (globalThis.process?.env?.PENETRATION_TAB_HIDDEN === "true") return false;
    return true;
  }
  if (tab === PAYLOAD_TAB) {
    if (isPayloadTabDisabled()) return false;
    if (flags?.hiddenFromNav) return false;
    if (globalThis.process?.env?.PAYLOAD_TAB_HIDDEN === "true") return false;
    return true;
  }
  return true;
}

// Whether a tab's route itself should be gated/disabled, generalized.
// Developer is never blocked.
export function routeBlocked(tab, flags) {
  if (tab === PENETRATION_TAB) {
    if (isPenetrationTabDisabled()) return true;
    if (flags?.disabled) return true;
    return false;
  }
  if (tab === PAYLOAD_TAB) {
    if (isPayloadTabDisabled()) return true;
    if (flags?.disabled) return true;
    return false;
  }
  return false;
}

// Legacy keys, preserved as thin wrappers.
export function showPayloadTabInNav(flags) {
  return showTabInNav(PAYLOAD_TAB, flags);
}

export function payloadRouteBlocked(flags) {
  return routeBlocked(PAYLOAD_TAB, flags);
}

export { CONSENT_KEY, ACTIVE_TAB_KEY };
