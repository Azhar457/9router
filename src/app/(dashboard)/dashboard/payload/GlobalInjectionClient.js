"use client";

// Global Injection surface — migrated from the Developer tab's playground
// (DeveloperPageClient.js) to the Jailbreaks tab. Owns all injection state:
// master toggle, register presets (G0DM0D3 + depth directive), godmode
// presets (payload Classic + catalog variants), carrier wrap, persona
// identity. Hydrates from /api/settings so every view reading the same
// settings keys never drifts apart. Persists presets under the same
// localStorage keys as before the move (developer.godmodePresets /
// developer.registerPresets / developer.personas) — data stays readable.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components";
import { getPersonaTemplate, PERSONA_TEMPLATES } from "@/shared/constants/developerPresets";
import { SETTINGS_CHANGED_EVENT } from "@/shared/lib/outboundManifest";
import { confirmPentestPayloadRisk, hasScopeAcknowledgement } from "@/shared/lib/tabConfig";
import { getCurrentLocale, onLocaleChange, translate } from "@/i18n/runtime";

const STORAGE_KEYS = {
  personas: "developer.personas",
  godmodePresets: "developer.godmodePresets",
  registerPresets: "developer.registerPresets",
};

function safeParse(value, fallback) {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

const INJECT_LEVELS = [
  { id: "none", label: "None — no register shaping" },
  { id: "lite", label: "Lite — silent self-check" },
  { id: "standard", label: "Standard — two drafts" },
  { id: "full", label: "Full — three drafts" },
  { id: "ultra", label: "Ultra — draft, attack, repair" },
];

const PAYLOAD_CATEGORIES_UI = [
  { key: "coding",   label: "💻 Coding" },
  { key: "pentest",  label: "🛡 Red-Team" },
  { key: "creative", label: "✍️ Creative / RP" },
  { key: "general",  label: "⚙ General" },
];

// Slot marker that carriers use to splice the main payload — matches
// CARRIER_SLOT in open-sse/rtk/payloadCatalog.js (keeps the seam highlight
// in sync with what the carrier-preview API reports).
const CARRIER_SLOT_MARK = "[YOUR JAILBREAK HERE]";

const GODMODE_VARIANTS = [
  // ── Coding ─────────────────────────────────────────────────────
  { id: "f:ai:gpt-5.6-bladwin", label: "📄 GPT 5.6 — Bladwin v67 (AI-Jailbreaks)", cat: "coding", new: true },
  { id: "f:bf:dev-mode",        label: "📄 BlackFriday — ChatGPT Dev Mode", cat: "coding" },
  { id: "f:bf:coding-jailbreak", label: "📄 BlackFriday — Coding Generator JB70", cat: "coding" },
  { id: "f:bf:codemaster-jailbreak", label: "📄 BlackFriday — CodeMaster JB", cat: "coding" },
  // ── Red-Team ───────────────────────────────────────────────────
  { id: "classic",           label: "Classic — G0DM0D3 + depth directive", cat: "pentest" },
  { id: "grok420",           label: "Grok 4.20 — semantic inversion", cat: "pentest" },
  { id: "geminiReset",       label: "Gemini Reset — RESET_CORTEX / !OMNI", cat: "pentest" },
  { id: "gptClassic",        label: "GPT Classic — OG GODMODE format", cat: "pentest" },
  { id: "claudeInversion",   label: "Claude Inversion — END/START boundary", cat: "pentest" },
  { id: "hermesFast",        label: "Hermes Fast — instant stream, zero refusal check", cat: "pentest" },
  { id: "adaptive",          label: "Adaptive — register-stripping, no jailbreak structure", cat: "pentest" },
  { id: "f:ai:nyx-v4",            label: "📄 NYX V4 multi-AI (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:cronus",            label: "📄 Cronus multi-AI (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:bladwin-67",        label: "📄 Bladwin 67 multi-AI (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:potato",            label: "📄 Potato multi-AI (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:opus-4.8",          label: "📄 Opus 4.8 — PERMABANXD (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:claude-sonnet-4.6", label: "📄 Claude Sonnet 4.6 — x10n nullsec (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:antigravity-thinking", label: "📄 Antigravity Sonnet/Opus 4.6 thinking (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:lens-v2",           label: "📄 LENS v2 (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:bladwin-claude",    label: "📄 Bladwin Claude v67 (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:claude-potato",     label: "📄 Claude — Potato (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:grok-nyx",          label: "📄 Grok — NYX instruction override (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:glm-rage",          label: "📄 GLM — RAGE v8.x (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:deepseek-gothbreach", label: "📄 DeepSeek — Gothbreach (AI-Jailbreaks)", cat: "pentest" },
  { id: "f:ai:deepseek1",         label: "📄 DeepSeek — Gothbreach v2 (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:kimi-k2.6-instant", label: "📄 Kimi K2.6 Instant (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:ai:opencode-nyx",     label: "📄 OpenCode — NYX V4 (AI-Jailbreaks)", cat: "pentest", new: true },
  { id: "f:bf:un-ethical-ai",    label: "📄 BlackFriday — DarkGPT un-ethical AI", cat: "pentest" },
  { id: "f:bf:manipulation-dan-v13", label: "📄 BlackFriday — Manipulation GPT × DAN v13", cat: "pentest" },
  { id: "f:bf:blackhat-programmer", label: "📄 BlackFriday — Blackhat Programmer", cat: "pentest", new: true },
  { id: "f:bf:blackhat-hacker",     label: "📄 BlackFriday — Blackhat Hacker", cat: "pentest", new: true },
  { id: "f:bf:unlimited-hacking",   label: "📄 BlackFriday — Unlimited Hacking AI", cat: "pentest", new: true },
  { id: "f:bf:ultimate-hacking",    label: "📄 BlackFriday — Ultimate Hacking AI", cat: "pentest", new: true },
  { id: "f:bf:s-dan",              label: "📄 BF — S-DAN (classic baseline)", cat: "pentest", new: true },
  // Carrier-type payloads live exclusively in section ③ (CARRIER_VARIANTS) —
  // they wrap OTHER payloads, so they are not selectable as the main payload.
  // Removed: f:bf:dark-roleplay-v12, f:bf:dark-roleplay-v11, f:bf:rfc-framework, VEIL
  // ── Creative / RP ──────────────────────────────────────────────
  { id: "f:ai:gemini-3.5-flash-lite", label: "📄 Gemini 3.5 Flash Lite — ENI RP (AI-Jailbreaks)", cat: "creative", new: true },
  // (nsfw roleplay variants removed — focus is attacking / building / pentest)
  // ── General / other ────────────────────────────────────────────
  { id: "f:ai:mistral",              label: "📄 Mistral (AI-Jailbreaks)", cat: "general", new: true },
  { id: "f:ai:qwen-3.8-max-preview", label: "📄 Qwen 3.8 Max Preview (AI-Jailbreaks)", cat: "general", new: true },
  { id: "custom",  label: "Custom — your own payload", cat: "general" },
];

const SORT_KEYS = [
  { id: "default",  label: "Default" },
  { id: "carrier",  label: "Carriers first" },
  { id: "relevance", label: "Relevance (current-gen first, small first)" },
  { id: "size-asc", label: "Smallest first" },
  { id: "size-desc", label: "Largest first" },
];

const CARRIER_VARIANTS = [
  { id: "", label: "Off" },
  { id: "f:bf:dark-roleplay-v12", label: "📦 Dark RP v1.2 BASE — meta-wrapper (slot [YOUR JAILBREAK HERE])", carrier: true },
  { id: "f:bf:dark-roleplay-v11", label: "📦 Dark RP v1.1 BASE — meta-wrapper", carrier: true },
  { id: "f:bf:rfc-framework", label: "📦 RFC Jailbreak Framework 454 — tag config", carrier: true },
  { id: "VEIL", label: "📦 VEIL — embedded identity frame", carrier: true, builtin: true },
  { id: "custom", label: "Custom carrier text (paste below)" },
];

export default function GlobalInjectionClient({ payloadCatalog }) {
  // Unified Global Injection state — one master toggle, sub-selectors
  const [injectEnabled, setInjectEnabled] = useState(false);
  const [injectLevel, setInjectLevel] = useState("standard");
  const [injectIdentity, setInjectIdentity] = useState("");
  const [injectPreview, setInjectPreview] = useState({ chars: 0, estTokens: 0, text: "" });
  const [godmodeLevel, setGodmodeLevel] = useState("classic");
  const [godmodeCustom, setGodmodeCustom] = useState("");
  const [godmodePreview, setGodmodePreview] = useState({ chars: 0, estTokens: 0, text: "" });
  const [savedGodmodePresets, setSavedGodmodePresets] = useState({});

  // i18n: re-render when the locale changes so translate() picks up the
  // current translation map.
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((v) => v + 1)), []);
  const [gmPresetSource, setGmPresetSource] = useState("");
  const [gmPresetName, setGmPresetName] = useState("");
  // Optional carrier column — wraps the main payload into a carrier slot.
  const [carrierEnabled, setCarrierEnabled] = useState(false);
  const [carrierLevel, setCarrierLevel] = useState("");
  const [carrierCustom, setCarrierCustom] = useState("");
  const [carrierPreview, setCarrierPreview] = useState({ chars: 0, estTokens: 0, spliced: false, text: "" });
  // Payload sort — "default" keeps the optgroup order; other options sort
  // by metadata from payloadCatalog.js (carriers first, current-gen first,
  // smallest first).
  const [payloadSort, setPayloadSort] = useState("default");
  const [savedPersonas, setSavedPersonas] = useState({});
  const [personaSource, setPersonaSource] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [registerCustom, setRegisterCustom] = useState("");
  const [registerLevel, setRegisterLevel] = useState("standard");
  const [registerEffective, setRegisterEffective] = useState("");
  const [registerPresetSource, setRegisterPresetSource] = useState("");
  const [registerPresetName, setRegisterPresetName] = useState("");
  const [savedRegisterPresets, setSavedRegisterPresets] = useState({});
  // Skill-router slot (Penetration tab) — display-only here: shows whether the
  // separate SKILL-ROUTER-STRIX block also ships alongside the jailbreak
  // payload. This card never edits it; the Penetration tab owns the slot.
  const [skillRouterActive, setSkillRouterActive] = useState(false);

  // Global Injection body is collapsible so the master switch stays visible.
  const [injectOpen, setInjectOpen] = useState(false);

  // Pentest-mode interaction: is the Penetration scope acknowledgement live?
  // Drives the persistent amber warning on the Global Injection card while
  // both surfaces are on at once. localStorage is null-gated off-client, so
  // SSR and the first client render agree; the `storage` event keeps this in
  // sync if the acknowledgement is granted/revoked in another browser tab.
  const [pentestAcked, setPentestAcked] = useState(false);
  useEffect(() => {
    const recheck = () => setPentestAcked(hasScopeAcknowledgement());
    recheck();
    globalThis.addEventListener?.("storage", recheck);
    return () => globalThis.removeEventListener?.("storage", recheck);
  }, []);

  // Single source of truth for hydrating the injection card from settings —
  // used on mount and whenever another view (Transparency console) patches
  // the same keys, so the two surfaces can never drift apart.
  //
  // `localEditInFlight`: when the user is actively typing in one of the
  // text editors (godmode / register / carrier / identity), the debounced
  // write to /api/settings is still pending. A stale SETTINGS_CHANGED_EVENT
  // or a late mount fetch landing in that window would otherwise overwrite
  // the textarea with the pre-edit snapshot, making the edit "revert to
  // empty". We skip syncing the keys the user is editing so local state stays
  // authoritative until the write settles.
  const localEditInFlight = useRef(null);
  function setLocalEditKey(key) { localEditInFlight.current = key; }
  function clearLocalEditKey() { localEditInFlight.current = null; }

  function syncInjectionFromSettings(settings) {
    const editing = localEditInFlight.current;
    // Unified keys take precedence; fall back to legacy plinian*/godmode* keys.
    if (editing !== "injectEnabled") setInjectEnabled(
      settings.injectionEnabled !== undefined
        ? !!settings.injectionEnabled
        : (!!settings.plinianEnabled || !!settings.godmodeEnabled)
    );
    const loadedLevel = settings.injectionRegisterLevel || settings.plinianLevel || "standard";
    if (editing !== "registerLevel") { setInjectLevel(loadedLevel); setRegisterLevel(loadedLevel); }
    if (editing !== "identity") setInjectIdentity(typeof settings.injectionIdentity === "string" ? settings.injectionIdentity : (settings.plinianIdentity || ""));
    if (editing !== "registerCustom") setRegisterCustom(typeof settings.injectionRegisterCustom === "string" ? settings.injectionRegisterCustom : "");
    if (editing !== "godmodeLevel") setGodmodeLevel(settings.injectionGodmodeLevel || settings.godmodeLevel || "classic");
    if (editing !== "godmodeCustom") setGodmodeCustom(typeof settings.injectionGodmodeCustom === "string" ? settings.injectionGodmodeCustom : (typeof settings.godmodeCustom === "string" ? settings.godmodeCustom : ""));
    if (editing !== "carrierEnabled") setCarrierEnabled(!!settings.injectionCarrierEnabled);
    if (editing !== "carrierLevel") setCarrierLevel(typeof settings.injectionCarrierLevel === "string" ? settings.injectionCarrierLevel : "");
    if (editing !== "carrierCustom") {
      const loadedCarrierCustom = typeof settings.injectionCarrierCustom === "string" ? settings.injectionCarrierCustom : "";
      setCarrierCustom(loadedCarrierCustom);
    }
    // Skill-router slot (Penetration tab) — read-only visibility: when the
    // SKILL-ROUTER-STRIX index is active, it ships as an extra block after
    // the jailbreak payload. This card shows it in the outbound list but
    // never edits it.
    setSkillRouterActive(!!(typeof settings.injectionSkillRouterCustom === "string" && settings.injectionSkillRouterCustom.trim()));
    // Hydrate the splice-seam flag from the persisted carrier text so the
    // seam highlight shows on first paint without needing a preset switch.
    setCarrierPreview((prev) => ({
      ...prev,
      spliced: !!settings.injectionCarrierEnabled && loadedCarrierCustom.includes(CARRIER_SLOT_MARK),
    }));
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((settings) => {
        if (cancelled) return;
        syncInjectionFromSettings(settings);
      })
      .catch(() => {})
      .finally(() => {
        try {
          const raw = globalThis.localStorage.getItem(STORAGE_KEYS.personas);
          if (raw) setSavedPersonas(safeParse(raw, {}));
          const gmRaw = globalThis.localStorage.getItem(STORAGE_KEYS.godmodePresets);
          if (gmRaw) setSavedGodmodePresets(safeParse(gmRaw, {}));
          const rgRaw = globalThis.localStorage.getItem(STORAGE_KEYS.registerPresets);
          if (rgRaw) setSavedRegisterPresets(safeParse(rgRaw, {}));
        } catch {}
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Another view (Transparency console) can flip the injection master switch or
  // the carrier wrap — re-read so this card shows what will actually ship.
  useEffect(() => {
    const onChanged = () => {
      fetch("/api/settings", { cache: "no-store" })
        .then((res) => res.json())
        .then(syncInjectionFromSettings)
        .catch(() => {});
    };
    globalThis.addEventListener?.(SETTINGS_CHANGED_EVENT, onChanged);
    return () => globalThis.removeEventListener?.(SETTINGS_CHANGED_EVENT, onChanged);
  }, []);

  async function patchSetting(patch) {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      // Settings persist best-effort; UI state already reflects intent.
    }
  }

  function toggleInject(value) {
    // Pentest-mode interaction guard: with a live Penetration scope
    // acknowledgement, turning the payload on requires explicit confirmation
    // — it skews Strix skill runs and raises token usage (the savers that
    // would offset it are disabled while a payload ships).
    if (value && !confirmPentestPayloadRisk()) return;
    setInjectEnabled(value);
    patchSetting({ injectionEnabled: value });
  }

  useEffect(() => {
    if (!injectEnabled) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch("/api/developer/plinian-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: injectLevel, identity: injectIdentity, registerCustom }),
      })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d?.text) setInjectPreview({ chars: d.chars || d.text.length, text: d.text }); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [injectEnabled, injectLevel, injectIdentity, registerCustom]);

  // Load the preset's canonical register text so the editor shows it. Re-runs
  // when the level changes (not when the user is mid-edit, so typing doesn't
  // wipe the textarea). Deferred past the first render so the setState call
  // is not synchronous-within-effect.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (injectLevel === "none") { setRegisterEffective(""); return; }
      fetch("/api/developer/plinian-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: injectLevel, preset: true }),
      })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d?.text) setRegisterEffective(d.text); })
        .catch(() => {});
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [injectLevel]);
  async function changeInjectLevel(level) {
    setInjectLevel(level);
    setRegisterLevel(level);
    // Load the preset's canonical register text into the editor (empty for
    // "none"). Switching presets clears any custom override — matches the
    // godmode variant behavior. Editing the loaded text flips to "custom".
    setRegisterCustom("");
    setRegisterEffective("");
    patchSetting({ injectionRegisterLevel: level, injectionRegisterCustom: "" });
    if (level !== "none") {
      try {
        const res = await fetch("/api/developer/plinian-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level, preset: true }),
        });
        const data = await res.json();
        if (data?.text) setRegisterEffective(data.text);
      } catch {}
    }
  }

  async function changeGodmodeVariant(level) {
    // Load the canonical payload text into the editor so users see (and can
    // edit) exactly what will ship. Editing the textarea flips the selector
    // to Custom (see handleGodmodeCustomChange).
    patchSetting({ injectionGodmodeLevel: level });
    setGodmodeLevel(level);

    try {
      const res = await fetch("/api/developer/godmode-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      const data = await res.json();
      if (data?.text) {
        setGodmodeCustom(data.text);
        if (level === "custom") patchSetting({ injectionGodmodeCustom: data.text || "" });
        setGodmodePreview({ chars: data.chars || data.text.length, estTokens: data.estTokens || 0, text: data.text });
      }
    } catch {}
  }

  // What the editor displays. In Custom mode that is the user's own
  // persisted text; on a preset level it is the preset's resolved text from
  // the preview, so the textarea is never blank while a real payload ships.
  // Only the Custom branch is ever written back to settings, which keeps
  // injectionGodmodeCustom meaning exactly "text the user authored" and stops
  // a settings re-read from blanking the editor under a live preset.
  const godmodeEditorText = godmodeLevel === "custom" ? godmodeCustom : godmodePreview.text;

  // Fill the preview for the selected preset level so the editor and the
  // char/token readout are transparent on first paint instead of showing an
  // empty editor next to a live count. Deferred past the first render so the
  // setState calls are not synchronous-within-effect.
  useEffect(() => {
    if (godmodeLevel === "custom") return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch("/api/developer/godmode-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: godmodeLevel }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d?.text) return;
          setGodmodePreview({ chars: d.chars || d.text.length, estTokens: d.estTokens || 0, text: d.text });
        })
        .catch(() => {});
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [godmodeLevel]);

  // Reorder payload variants by sort key using the catalog metadata.
  // "default" preserves the original optgroup order; the others sort by
  // metadata so carriers / current-gen / smallest surface first.
  function sortVariants(items) {
    if (!payloadCatalog || payloadSort === "default") return items;
    const meta = new Map(payloadCatalog.map((row) => [row.id, row]));
    const copy = [...items];
    const lookup = (v) => meta.get(v.id) || { sizeChars: 0, isCarrier: false, hasBuiltInCarrier: false, effectiveness: "current" };
    switch (payloadSort) {
      case "carrier":
        copy.sort((a, b) => {
          const ca = lookup(a).isCarrier || lookup(a).hasBuiltInCarrier ? 0 : 1;
          const cb = lookup(b).isCarrier || lookup(b).hasBuiltInCarrier ? 0 : 1;
          return ca - cb || a.label.localeCompare(b.label);
        });
        break;
      case "relevance":
        copy.sort((a, b) => {
          const la = lookup(a), lb = lookup(b);
          const current = (r) => (r.effectiveness === "current" ? 0 : 1);
          const diff = current(la) - current(lb);
          if (diff) return diff;
          return la.sizeChars - lb.sizeChars;
        });
        break;
      case "size-asc":
        copy.sort((a, b) => lookup(a).sizeChars - lookup(b).sizeChars);
        break;
      case "size-desc":
        copy.sort((a, b) => lookup(b).sizeChars - lookup(a).sizeChars);
        break;
      default:
        break;
    }
    return copy;
  }

  // ── Carrier (optional column) handlers ─────────────────────────
  function toggleCarrierEnabled(value) {
    setCarrierEnabled(value);
    patchSetting({ injectionCarrierEnabled: value, injectionCarrierLevel: value ? (carrierLevel || "f:bf:dark-roleplay-v12") : "" });
  }

  // Track whether the carrier text has been hand-edited past its preset —
  // so switching presets does not silently clobber the user's edits.
  const carrierEditedRef = useRef(false);

  async function changeCarrierVariant(level) {
    setCarrierLevel(level);
    if (level === "custom" || !level) {
      // custom / off: don't clobber existing text; off clears
      if (!level) {
        setCarrierCustom("");
        patchSetting({ injectionCarrierLevel: "", injectionCarrierCustom: "" });
        setCarrierPreview({ chars: 0, estTokens: 0, spliced: false, text: "" });
      }
      carrierEditedRef.current = level === "custom";
      return;
    }
    // Guard: refuse to overwrite a hand-edited carrier text.
    if (carrierEditedRef.current && carrierCustom.trim()) {
      if (globalThis.confirm?.(`Carrier text has been hand-edited. Replace it with the "${level}" preset?`)) {
        carrierEditedRef.current = false;
      } else {
        setCarrierLevel("custom");
        return;
      }
    }
    carrierEditedRef.current = false;
    setCarrierCustom("");
    patchSetting({ injectionCarrierLevel: level, injectionCarrierCustom: "" });
    try {
      const res = await fetch("/api/developer/carrier-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: godmodeLevel, custom: godmodeCustom, carrierLevel: level }),
      });
      const data = await res.json();
      if (data?.text) {
        setCarrierCustom(data.text);
        patchSetting({ injectionCarrierCustom: data.text });
        setCarrierPreview({ chars: data.chars, estTokens: data.estTokens, spliced: data.spliced, text: data.text });
      }
    } catch {}
  }

  const carrierSaveTimerRef = useRef(null);
  function handleCarrierCustomChange(event) {
    const value = event.target.value;
    setLocalEditKey("carrierCustom");
    setCarrierCustom(value);
    // First manual edit to the carrier text flips it into "custom" mode —
    // any subsequent preset switch will prompt before clobbering it.
    carrierEditedRef.current = true;
    if (carrierLevel !== "custom" && value.trim()) setCarrierLevel("custom");
    // Live splice-seam state: a hand edit can remove (or add back) the slot
    // marker, so the preview flag follows the actual text, not the preset.
    setCarrierPreview((prev) => ({ ...prev, spliced: value.includes(CARRIER_SLOT_MARK) }));
    clearTimeout(carrierSaveTimerRef.current);
    carrierSaveTimerRef.current = setTimeout(() => {
      if (localEditInFlight.current === "carrierCustom") clearLocalEditKey();
      patchSetting({ injectionCarrierCustom: value, injectionCarrierLevel: carrierLevel === "custom" ? "custom" : carrierLevel });
    }, 600);
  }

  function persistGodmodePresets(next) {
    setSavedGodmodePresets(next);
    globalThis.localStorage.setItem(STORAGE_KEYS.godmodePresets, JSON.stringify(next));
  }

  function applyGmPresetSource() {
    if (!gmPresetSource.startsWith("user:")) return;
    const text = savedGodmodePresets[gmPresetSource.slice(5)];
    if (text !== undefined) {
      // Saved presets are free-form text: they only ship in Custom mode
      // (getGodmodePrompt ignores custom text for preset levels), so applying
      // one flips the selector to Custom. Otherwise the applied preset would
      // silently NOT ship while the textarea pretends it will.
      setGodmodeCustom(text);
      setGodmodeLevel("custom");
      patchSetting({ injectionGodmodeLevel: "custom", injectionGodmodeCustom: text });
    }
  }

  function saveGmPreset() {
    const name = (gmPresetName.trim() || `Payload ${Object.keys(savedGodmodePresets).length + 1}`).slice(0, 40);
    // Save what the editor actually shows, not just the Custom slot — on a
    // preset level the text lives in the preview, so reading godmodeCustom
    // here would refuse to save a real payload as an empty preset.
    const text = godmodeEditorText;
    if (!text.trim()) return;
    persistGodmodePresets({ ...savedGodmodePresets, [name]: text });
    setGmPresetSource(`user:${name}`);
  }

  function deleteGmPreset() {
    if (!gmPresetSource.startsWith("user:")) return;
    const name = gmPresetSource.slice(5);
    const next = { ...savedGodmodePresets };
    delete next[name];
    persistGodmodePresets(next);
    setGmPresetSource("");
  }

  // Debounced so every keystroke does not hit the settings DB.
  const godmodeSaveTimerRef = useRef(null);
  function handleGodmodeCustomChange(event) {
    const value = event.target.value;
    setLocalEditKey("godmodeCustom");
    setGodmodeCustom(value);
    // Editing the payload must always ship the edited text: flip the selector
    // to Custom (preset levels ignore custom text — see getGodmodePrompt).
    // Level + text are patched together in one debounced write so they can
    // never go out of sync.
    if (godmodeLevel !== "custom") setGodmodeLevel("custom");
    clearTimeout(godmodeSaveTimerRef.current);
    godmodeSaveTimerRef.current = setTimeout(() => {
      if (localEditInFlight.current === "godmodeCustom") clearLocalEditKey();
      patchSetting({ injectionGodmodeLevel: "custom", injectionGodmodeCustom: value });
    }, 600);
  }

  // ── Register (Plinian) preset + custom editor ─────────────────────────
  // "lvl:<id>" applies the built-in Plinian preset; "user:<name>" applies a
  // saved custom register. Both write the exact text into the editor so the
  // user sees (and can edit) what ships. Empty editor = use the preset level.
  function persistRegisterPresets(next) {
    setSavedRegisterPresets(next);
    globalThis.localStorage.setItem(STORAGE_KEYS.registerPresets, JSON.stringify(next));
  }

  function applyRegisterPreset() {
    if (!registerPresetSource) return;
    if (registerPresetSource.startsWith("lvl:")) {
      const lvl = registerPresetSource.slice(4);
      changeInjectLevel(lvl); // loads preset text into the editor
      return;
    }
    if (registerPresetSource.startsWith("user:")) {
      const text = savedRegisterPresets[registerPresetSource.slice(5)];
      if (text !== undefined) {
        setRegisterCustom(text);
        patchSetting({ injectionRegisterCustom: text });
      }
    }
  }

  function saveRegisterPreset() {
    const name = (registerPresetName.trim() || `Register ${Object.keys(savedRegisterPresets).length + 1}`).slice(0, 40);
    if (!registerCustom.trim()) return;
    persistRegisterPresets({ ...savedRegisterPresets, [name]: registerCustom });
    setRegisterPresetSource(`user:${name}`);
  }

  function deleteRegisterPreset() {
    if (!registerPresetSource.startsWith("user:")) return;
    const name = registerPresetSource.slice(5);
    const next = { ...savedRegisterPresets };
    delete next[name];
    persistRegisterPresets(next);
    setRegisterPresetSource("");
  }

  // Debounced so every keystroke does not hit the settings DB.
  const registerSaveTimerRef = useRef(null);
  function handleRegisterCustomChange(event) {
    const value = event.target.value;
    setLocalEditKey("registerCustom");
    setRegisterCustom(value);
    clearTimeout(registerSaveTimerRef.current);
    registerSaveTimerRef.current = setTimeout(() => {
      if (localEditInFlight.current === "registerCustom") clearLocalEditKey();
      patchSetting({ injectionRegisterCustom: value });
    }, 600);
  }

  function persistPersonas(next) {
    setSavedPersonas(next);
    globalThis.localStorage.setItem(STORAGE_KEYS.personas, JSON.stringify(next));
  }

  function applyPersonaSource() {
    if (!personaSource) return;
    if (personaSource.startsWith("tpl:")) {
      const tpl = getPersonaTemplate(personaSource.slice(4));
      if (tpl) {
        setInjectIdentity(tpl.text);
        patchSetting({ injectionIdentity: tpl.text });
      }
    } else if (personaSource.startsWith("user:")) {
      const text = savedPersonas[personaSource.slice(5)];
      if (text !== undefined) {
        setInjectIdentity(text);
        patchSetting({ injectionIdentity: text });
      }
    }
  }

  function savePersona() {
    const name = (personaName.trim() || `Preset ${Object.keys(savedPersonas).length + 1}`).slice(0, 40);
    if (!injectIdentity.trim()) return;
    persistPersonas({ ...savedPersonas, [name]: injectIdentity });
    setPersonaSource(`user:${name}`);
  }

  function deletePersona() {
    if (!personaSource.startsWith("user:")) return;
    const name = personaSource.slice(5);
    const next = { ...savedPersonas };
    delete next[name];
    persistPersonas(next);
    setPersonaSource("");
  }

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      fetch("/api/developer/godmode-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: godmodeLevel, custom: godmodeCustom }),
      })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d?.text) setGodmodePreview({ chars: d.chars || d.text.length, estTokens: d.estTokens || 0, text: d.text }); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [godmodeLevel, godmodeCustom]);

  // Debounced so every keystroke does not hit the settings DB.
  const identitySaveTimerRef = useRef(null);
  function handleInjectIdentityChange(event) {
    const value = event.target.value;
    setLocalEditKey("identity");
    setInjectIdentity(value);
    clearTimeout(identitySaveTimerRef.current);
    identitySaveTimerRef.current = setTimeout(() => {
      if (localEditInFlight.current === "identity") clearLocalEditKey();
      patchSetting({ injectionIdentity: value });
    }, 600);
  }

  return (
    <div className="rounded-xl border border-border bg-surface/40">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span className={`material-symbols-outlined text-[20px] ${injectEnabled ? "text-primary" : "text-text-muted"}`}>bolt</span>
        <div className="flex min-w-[220px] flex-col">
          <span className="text-sm font-medium text-text-main">Global Injection</span>
          <span className="text-xs text-text-muted">
            {injectEnabled
              ? translate(`Active for all tabs & all clients — register ${injectLevel} + payload ${godmodeLevel === "custom" ? "Custom" : (GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.label || godmodeLevel)} · ${(godmodePreview.chars || 0).toLocaleString("en-US")} chars`)
              : translate("OFF — no payload added to any request")}
          </span>
        </div>
        <button
          onClick={() => toggleInject(!injectEnabled)}
          className={`h-8 rounded-lg px-4 text-xs font-semibold transition-colors ${
            injectEnabled
              ? "bg-green-600 text-white hover:bg-green-700"
              : "bg-surface-2 border border-border text-text-muted hover:text-text-main"
          }`}
        >
          {injectEnabled ? "ON" : "OFF"}
        </button>
        <button
          onClick={() => setInjectOpen((v) => !v)}
          aria-expanded={injectOpen}
          className="h-8 rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold text-text-main transition-colors hover:bg-surface"
        >
          <span className="material-symbols-outlined text-[16px] align-middle">{injectOpen ? "expand_less" : "expand_more"}</span>{" "}
          {injectOpen ? translate("Close") : translate("Configure payload")}
        </button>
      </div>

      {/* Pentest-mode interaction warning: both surfaces active at once.
          Persistent (not just at toggle time) so it stays visible across
          tabs — the master switch ships on every request made from here. */}
      {injectEnabled && pentestAcked && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-t border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
        >
          <span className="material-symbols-outlined text-[16px]">warning</span>
          <span>
            <strong>Penetration mode is active.</strong> The payload ships on every request — it can skew Strix skill runs and raises token usage (Headroom/Caveman/Ponytail are disabled while a payload is active). Review targets + scope in the Penetration tab.
          </span>
        </div>
      )}

      {injectOpen && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div
            className={`flex flex-col gap-4 w-full ${injectEnabled ? "" : "pointer-events-none select-none opacity-40"}`}
            aria-disabled={!injectEnabled}
          >
              {/* ── 1. Persona preset ───────────────────────────── */}
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Persona</span>
                  <select
                    value={personaSource}
                    onChange={(event) => setPersonaSource(event.target.value)}
                    className="h-8 min-w-[220px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    <option value="">Preset persona…</option>
                    <optgroup label="Templates">
                      {PERSONA_TEMPLATES.map((tpl) => (
                        <option key={tpl.id} value={`tpl:${tpl.id}`}>
                          {tpl.label}
                        </option>
                      ))}
                    </optgroup>
                    {Object.keys(savedPersonas).length > 0 && (
                      <optgroup label="My presets">
                        {Object.keys(savedPersonas).map((name) => (
                          <option key={name} value={`user:${name}`}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <Button variant="secondary" size="sm" icon="download" onClick={applyPersonaSource} disabled={!personaSource}>
                    Apply
                  </Button>
                  <input
                    value={personaName}
                    onChange={(event) => setPersonaName(event.target.value)}
                    placeholder="Preset 1…"
                    className="h-8 w-32 rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  />
                  <Button variant="secondary" size="sm" icon="save" onClick={savePersona} disabled={!injectIdentity.trim()}>
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="delete"
                    onClick={deletePersona}
                    disabled={!personaSource.startsWith("user:")}
                  >
                    Delete
                  </Button>
                </div>
                <textarea
                  value={injectIdentity}
                  onChange={handleInjectIdentityChange}
                  rows={2}
                  readOnly={!injectEnabled}
                  placeholder="Optional identity override, prepended first — e.g. &quot;You are 9Router-Plinian, the local AI routing gateway. If asked who you are, answer: I'm 9Router-Plinian — local gateway. Ready.&quot;"
                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50"
                />
              </div>

              {/* ── 2a. Preset & prompt list ─────────────────── */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">① Preset &amp; Prompt list</span>
                  <span className="text-[10px] text-text-muted">variant payload atau preset tersimpan — dipakai apa adanya (WYSIWYG)</span>
                </header>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Payload</span>
                  <select
                    value={payloadSort}
                    onChange={(event) => setPayloadSort(event.target.value)}
                    title="Reorder payload list by catalog metadata"
                    className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    {SORT_KEYS.map((key) => (
                      <option key={key.id} value={key.id}>{key.label}</option>
                    ))}
                  </select>
                  <select
                    value={godmodeLevel}
                    onChange={(event) => changeGodmodeVariant(event.target.value)}
                    className="h-8 min-w-[280px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    {PAYLOAD_CATEGORIES_UI.map((cat) => {
                      const items = sortVariants(GODMODE_VARIANTS.filter((v) => v.cat === cat.key));
                      if (!items.length) return null;
                      return (
                        <optgroup key={cat.key} label={cat.label}>
                          {items.map((variant) => (
                            <option key={variant.id} value={variant.id}>
                              {variant.label}{variant.new ? " 🆕 new" : ""}{variant.builtInCarrier ? " (already wraps)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <select
                    value={gmPresetSource}
                    onChange={(event) => setGmPresetSource(event.target.value)}
                    className="h-8 min-w-[200px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    <option value="">Saved payload preset…</option>
                    {Object.keys(savedGodmodePresets).length > 0 && (
                      <optgroup label="My payloads">
                        {Object.keys(savedGodmodePresets).map((name) => (
                          <option key={name} value={`user:${name}`}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <Button variant="secondary" size="sm" icon="download" onClick={applyGmPresetSource} disabled={!gmPresetSource}>
                    Apply
                  </Button>
                  <input
                    value={gmPresetName}
                    onChange={(event) => setGmPresetName(event.target.value)}
                    placeholder="Payload 1…"
                    className="h-8 w-32 rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  />
                  <Button variant="secondary" size="sm" icon="save" onClick={saveGmPreset} disabled={!godmodeCustom.trim()}>
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="delete"
                    onClick={deleteGmPreset}
                    disabled={!gmPresetSource.startsWith("user:")}
                  >
                    Delete
                  </Button>
                </div>
              </section>

              {/* ── 2b. Payload editor (exactly what ships) ───── */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">② Payload editor</span>
                  <span className="text-[10px] text-text-muted">mengedit otomatis memindah selector ke Custom</span>
                </header>
                <textarea
                  value={godmodeEditorText}
                  onChange={handleGodmodeCustomChange}
                  rows={6}
                  readOnly={!injectEnabled}
                  placeholder="Effective jailbreak payload — editing switches the payload selector to Custom mode."
                  className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50 read-only:cursor-not-allowed read-only:opacity-60"
                />
                <p className="text-[10px] text-text-muted">
                  Effective payload: <span className="font-semibold text-text-main">{godmodeLevel === "custom" ? "Custom" : GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.label || godmodeLevel}</span>{GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.new && <span className="ml-1 text-primary">🆕 new</span>}
                  {" · "}{godmodePreview.chars.toLocaleString("en-US")} chars{godmodePreview.estTokens ? ` · ≈${(godmodePreview.estTokens >= 1000 ? (godmodePreview.estTokens / 1000).toFixed(1) + "k" : godmodePreview.estTokens)} tok` : ""}
                </p>
              </section>

              {/* ── 2c. Carrier (optional column) ─────────────── */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/40 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">③ Carrier wrap</span>
                  <span className="text-[10px] text-text-muted">optional — not always more effective</span>
                </header>
                <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      <input
                        type="checkbox"
                        checked={carrierEnabled}
                        onChange={(event) => toggleCarrierEnabled(event.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      Carrier wrap
                    </label>
                    {carrierEnabled && (
                      <>
                        <select
                          value={carrierLevel}
                          onChange={(event) => changeCarrierVariant(event.target.value)}
                          className="h-8 min-w-[240px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                        >
                          {CARRIER_VARIANTS.map((variant) => (
                            <option key={variant.id || "off"} value={variant.id}>
                              {variant.label}{variant.carrier ? " (auto-wrap)" : ""}
                            </option>
                          ))}
                        </select>
                        <span className="text-[10px] text-text-muted">
                          {carrierPreview.spliced
                            ? "📦 splices payload into [YOUR JAILBREAK HERE]"
                            : (carrierLevel ? "appends payload after carrier (no slot)" : "")}
                        </span>
                        {carrierPreview.spliced && (
                          <div className="flex w-full items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1.5 text-[11px]">
                            <span className="font-mono font-semibold text-primary">⚡ SEAM: {"[YOUR JAILBREAK HERE]"}</span>
                            <span className="text-text-muted">← payload (section ①) is spliced in here when this carrier ships</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {carrierEnabled && (
                    <textarea
                      value={carrierCustom}
                      onChange={handleCarrierCustomChange}
                      rows={3}
                      readOnly={!injectEnabled}
                      placeholder="Effective carrier text — edit to customize the wrap (e.g. tweak the [YOUR JAILBREAK HERE] slot or add framing)."
                      className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50 read-only:cursor-not-allowed read-only:opacity-60"
                    />
                  )}
              </section>

              {/* ── 3. Register (Plinian) prompt ───────────────── */}
              <section className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2/30 p-2.5">
                <header className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-main">④ Register prompt</span>
                  <span className="text-[10px] text-text-muted">teks custom menimpa preset — dikirim apa adanya</span>
                </header>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Register</span>
                  <select
                    value={registerPresetSource}
                    onChange={(event) => setRegisterPresetSource(event.target.value)}
                    className="h-8 min-w-[220px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    <option value="">Preset register…</option>
                    <optgroup label="Plinian presets">
                      {INJECT_LEVELS.map((level) => (
                        <option key={level.id} value={`lvl:${level.id}`}>
                          {level.label}
                        </option>
                      ))}
                    </optgroup>
                    {Object.keys(savedRegisterPresets).length > 0 && (
                      <optgroup label="My register presets">
                        {Object.keys(savedRegisterPresets).map((name) => (
                          <option key={name} value={`user:${name}`}>
                            {name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <Button variant="secondary" size="sm" icon="download" onClick={applyRegisterPreset} disabled={!registerPresetSource}>
                    Apply
                  </Button>
                  <input
                    value={registerPresetName}
                    onChange={(event) => setRegisterPresetName(event.target.value)}
                    placeholder="Custom 1…"
                    className="h-8 w-28 rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  />
                  <Button variant="secondary" size="sm" icon="save" onClick={saveRegisterPreset} disabled={!registerCustom.trim()}>
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="delete"
                    onClick={deleteRegisterPreset}
                    disabled={!registerPresetSource.startsWith("user:")}
                  >
                    Delete
                  </Button>
                   <span className="text-[10px] text-text-muted">
                     {registerCustom.trim()
                       ? `${registerCustom.length.toLocaleString("en-US")} chars custom register — overrides ${injectLevel} preset`
                       : (injectLevel === "none"
                           ? "none — no register shaping"
                           : `preset ${injectLevel} · ${(registerEffective.length || injectPreview.chars || 0).toLocaleString("en-US")} chars`)}
                   </span>
                 </div>
                 <textarea
                   value={registerCustom.trim() ? registerCustom : registerEffective}
                   onChange={handleRegisterCustomChange}
                   rows={4}
                   disabled={!injectEnabled || injectLevel === "none"}
                   placeholder={injectLevel === "none" ? "Register disabled (none)" : "Edit the register text — editing flips to Custom; save an empty value to fall back to the preset"}
                   className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
                 />
              </section>

              <div className="rounded-lg border border-border bg-surface-2/50 p-2">
                <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
                  <span className="font-semibold text-text-main">Outbound system (what ships, in order)</span>
                  <span>register {(registerCustom.trim() ? registerCustom.length : (injectPreview.chars || 0)).toLocaleString("en-US")} + payload {(godmodePreview.chars || 0).toLocaleString("en-US")} chars · ≈{Math.round((registerCustom.trim() ? registerCustom.length : (injectPreview.chars || 0)) / 4 + (godmodePreview.chars || 0) / 4) >= 1000 ? `${(Math.round((registerCustom.trim() ? registerCustom.length : (injectPreview.chars || 0)) / 4 + (godmodePreview.chars || 0) / 4) / 1000).toFixed(1)}k` : Math.round((registerCustom.trim() ? registerCustom.length : (injectPreview.chars || 0)) / 4 + (godmodePreview.chars || 0) / 4)} tok (aggregate est)</span>
                </div>
                <ol className="space-y-0.5 text-[10px] text-text-muted">
                  <li>
                    <span className="font-semibold text-text-main">1. Register</span> —{" "}
                    {registerCustom.trim()
                      ? `custom (${registerCustom.length.toLocaleString("en-US")} chars, overrides ${injectLevel} preset)`
                      : (injectLevel === "none" ? "none (no register shaping)" : `preset ${injectLevel}`)}
                    {injectIdentity.trim() ? " (+ persona identity)" : ""}
                  </li>
                  <li>
                    <span className="font-semibold text-text-main">2. Jailbreak payload</span> —{" "}
                    {godmodeLevel === "custom" ? "Custom" : GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.label || godmodeLevel}
                    {GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.new && <span className="ml-1 text-primary">🆕 new</span>}
                  </li>
                  {carrierEnabled && (
                    <li>
                      <span className="font-semibold text-text-main">3. Carrier wrap</span> —{" "}
                      {carrierLevel ? (CARRIER_VARIANTS.find((v) => (v.id || "off") === carrierLevel)?.label || carrierLevel) : "Custom carrier"}
                      {carrierPreview.spliced ? " (auto-wraps payload)" : " (appends payload)"}
                    </li>
                  )}
                  {skillRouterActive && (
                    <li>
                      <span className="font-semibold text-text-main">{carrierEnabled ? "4" : "3"}. Skill router</span> —{" "}
                      SKILL-ROUTER-STRIX index (Penetration tab, separate slot —{" "}
                      <a href="/dashboard/penetration" className="underline underline-offset-2 hover:text-text-main">manage it there</a>)
                    </li>
                  )}
                </ol>
                <p className="mt-1 text-[10px] text-text-muted">
                  While ON, both are appended to every proxied request — Hermes, CLI tools, all clients.
                </p>
              </div>
              {carrierEnabled && (
                <p className="text-[10px] text-text-muted">
                  With carrier ON, the payload rides inside the carrier frame on every proxied request — toggle off if wrapping hurts land-rate for your target model.
                </p>
              )}
            </div>
            {!injectEnabled && (
              <p className="text-[11px] font-medium text-amber-500">
                🔒 {translate("Locked — turn on Global Injection to edit Persona, Preset, Payload, Carrier, and Register.")}
              </p>
            )}
          </div>
        )}
    </div>
  );
}
