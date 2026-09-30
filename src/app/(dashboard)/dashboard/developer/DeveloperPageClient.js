"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components";
import {
  getPersonaTemplate,
  getStylePreset,
  PERSONA_TEMPLATES,
  RACE_HARD_TIMEOUT_MS,
  RACE_WAVE_DELAY_MS,
  RACE_WAVE_SIZE,
  STYLE_PRESETS,
  TIER_SIZES,
} from "@/shared/constants/developerPresets";
import { countHedges, rankResults, scoreResponse } from "@/shared/lib/plinianScoring";
import { suggestParams } from "@/shared/lib/autotuneLite";
import ToolkitClient from "./ToolkitClient";
import TransparencyClient from "./TransparencyClient";

const STORAGE_KEYS = {
  mode: "developer.mode",
  style: "developer.style",
  customPrompt: "developer.customPrompt",
  temperature: "developer.temperature",
  maxTokens: "developer.maxTokens",
  singleModel: "developer.singleModel",
  raceModels: "developer.raceModels",
  draft: "developer.draft",
  abPreset: "developer.abPreset",
  abTokenSaver: "developer.abTokenSaver",
  autotune: "developer.autotune",
  personas: "developer.personas",
  godmodePresets: "developer.godmodePresets",
  registerPresets: "developer.registerPresets",
  singleOutput: "developer.singleOutput",
  raceItems: "developer.raceItems",
  abItems: "developer.abItems",
  councilRows: "developer.councilRows",
  councilSynth: "developer.councilSynth",
};

function saveLarge(key, data) {
  try {
    const json = JSON.stringify(data);
    if (json.length <= 900000) globalThis.localStorage.setItem(key, json);
  } catch {}
}

function reviveEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const status = entry.status === "done" ? "done"
    : entry.status === "error" ? "error"
    : (entry.content ? "done" : "error");
  return {
    ...entry,
    status,
    error: status === "error" && !entry.error ? "Interrupted (page changed)" : entry.error || "",
  };
}

function readStoredEntries(key) {
  const raw = readStoredString(key);
  if (!raw) return [];
  const arr = safeParse(raw, []);
  return Array.isArray(arr) ? arr.map(reviveEntry).filter(Boolean) : [];
}

const INJECT_LEVELS = [
  { id: "none", label: "None — no register shaping" },
  { id: "lite", label: "Lite — silent self-check" },
  { id: "standard", label: "Standard — two drafts" },
  { id: "full", label: "Full — three drafts" },
  { id: "ultra", label: "Ultra — draft, attack, repair" },
];

const GODMODE_VARIANTS = [
  { id: "classic", label: "Classic — G0DM0D3 + depth directive" },
  { id: "grok420", label: "Grok 4.20 — semantic inversion" },
  { id: "geminiReset", label: "Gemini Reset — RESET_CORTEX / !OMNI" },
  { id: "gptClassic", label: "GPT Classic — OG GODMODE format" },
  { id: "claudeInversion", label: "Claude Inversion — END/START boundary" },
  { id: "hermesFast", label: "Hermes Fast — instant stream, zero refusal check" },
  { id: "adaptive", label: "Adaptive — register-stripping, no jailbreak structure" },
  { id: "f:ai:opus-4.8", label: "📄 Opus 4.8 — PERMABANXD (AI-Jailbreaks)", new: true },
  { id: "f:ai:claude-sonnet-4.6", label: "📄 Claude Sonnet 4.6 — x10n nullsec (AI-Jailbreaks)", new: true },
  { id: "f:ai:antigravity-thinking", label: "📄 Antigravity Sonnet/Opus 4.6 thinking (AI-Jailbreaks)", new: true },
  { id: "f:ai:lens-v2", label: "📄 LENS v2 (AI-Jailbreaks)", new: true },
  { id: "f:ai:bladwin-claude", label: "📄 Bladwin Claude v67 (AI-Jailbreaks)", new: true },
  { id: "f:ai:nyx-v4", label: "📄 NYX V4 multi-AI (AI-Jailbreaks)" },
  { id: "f:ai:cronus", label: "📄 Cronus multi-AI (AI-Jailbreaks)" },
  { id: "f:ai:bladwin-67", label: "📄 Bladwin 67 multi-AI (AI-Jailbreaks)" },
  { id: "f:ai:potato", label: "📄 Potato multi-AI (AI-Jailbreaks)" },
  { id: "f:ai:gpt-5.6-bladwin", label: "📄 GPT 5.6 — Bladwin v67 (AI-Jailbreaks)", new: true },
  { id: "f:ai:grok-nyx", label: "📄 Grok — NYX instruction override (AI-Jailbreaks)" },
  { id: "f:ai:glm-rage", label: "📄 GLM — RAGE v8.x (AI-Jailbreaks)" },
  { id: "f:ai:deepseek-gothbreach", label: "📄 DeepSeek — Gothbreach (AI-Jailbreaks)" },
  { id: "f:bf:un-ethical-ai", label: "📄 BlackFriday — DarkGPT un-ethical AI" },
  { id: "f:bf:manipulation-dan-v13", label: "📄 BlackFriday — Manipulation GPT × DAN v13" },
  { id: "f:bf:dev-mode", label: "📄 BlackFriday — ChatGPT Dev Mode" },
  { id: "VEIL", label: "VEIL" },
  { id: "custom", label: "Custom — your own payload" },
];

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function humanize(value = "") {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

// Normalize /v1/models entries into the page's model shape. The id IS the
// routable model string accepted by /v1/chat/completions.
function normalizeV1Model(model) {
  const rawId = typeof model === "string" ? model : model?.id || "";
  if (!rawId) return null;
  if (model?.kind && model.kind !== "llm") return null;
  if (/\/(search|fetch)$/.test(rawId)) return null;

  const ownedBy = (typeof model === "object" && model?.owned_by) || rawId.split("/")[0] || "unknown";
  const shortName = rawId.includes("/") ? rawId.slice(rawId.indexOf("/") + 1) : rawId;

  return {
    id: rawId,
    requestModel: rawId,
    name: shortName,
    providerId: ownedBy,
    providerName: humanize(ownedBy),
  };
}

async function readStreamedCompletion(response, onText) {
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json().catch(() => ({}));
    const fallback = textValue(data?.choices?.[0]?.message?.content || data?.output_text || data?.error || data?.message || "");
    if (fallback && onText) onText(fallback);
    return fallback;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const chunk = JSON.parse(payload);
        const choice = chunk.choices?.[0];
        const delta = choice?.delta || {};
        const piece = [delta.content, choice?.message?.content, chunk.output_text, chunk.text]
          .map(textValue)
          .filter(Boolean)[0];
        if (!piece) continue;

        full += piece;
        if (onText) onText(full, piece);
      } catch {
        // Ignore malformed chunks.
      }
    }
  }

  return full;
}

function buildMessages(systemPrompt, query) {
  const messages = [];
  const system = String(systemPrompt || "").trim();
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: query });
  return messages;
}

function errorHint(message) {
  const msg = String(message || "");
  if (msg.includes("404")) return " (model not routable — model list may be stale, reload the page)";
  if (msg.includes("503")) return " (no active API key in this router — create one in Endpoint settings)";
  if (msg.includes("401")) return " (session expired — reload the page to log in again)";
  return "";
}

// One request through the dashboard relay. Shared by Single / Race / A-B.
async function launchOne({ model, systemPromptText, query, temperature: temp, maxTokens: maxTok, signal, noSteering = false }) {
  const startedAt = performance.now();
  try {
    const response = await fetch("/api/developer/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: model.requestModel || model.id,
        messages: buildMessages(systemPromptText, query),
        stream: true,
        temperature: temp,
        max_tokens: maxTok,
        ...(noSteering ? { _noSteering: true } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(textValue(errorData.error || errorData.message || `HTTP ${response.status}`));
    }

    const content = await readStreamedCompletion(response);
    const duration_ms = Math.round(performance.now() - startedAt);
    if (!content) throw new Error("Empty response");
    return { ok: true, content, duration_ms };
  } catch (error) {
    const msg = error.name === "AbortError" ? "Cancelled" : textValue(error?.message) || "Failed";
    return { ok: false, duration_ms: Math.round(performance.now() - startedAt), error: msg };
  }
}

function readStoredString(key, fallback = "") {
  if (typeof window === "undefined") return fallback;
  return globalThis.localStorage.getItem(key) ?? fallback;
}

function readStoredNumber(key, fallback, min, max) {
  const value = parseFloat(readStoredString(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export default function DeveloperPageClient() {
  const [providerGroups, setProviderGroups] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [mode, setMode] = useState(() => {
    const saved = readStoredString(STORAGE_KEYS.mode, "single");
    return ["single", "race", "ab", "council"].includes(saved) ? saved : "single";
  });
  const [styleId, setStyleId] = useState(() => readStoredString(STORAGE_KEYS.style, "plain"));
  const [customPrompt, setCustomPrompt] = useState(() => readStoredString(STORAGE_KEYS.customPrompt));
  const [temperature, setTemperature] = useState(() => readStoredNumber(STORAGE_KEYS.temperature, 0.7, 0, 2));
  const [maxTokens, setMaxTokens] = useState(() => readStoredNumber(STORAGE_KEYS.maxTokens, 4096, 128, 128000));
  const [draft, setDraft] = useState(() => readStoredString(STORAGE_KEYS.draft));
  const [singleModelId, setSingleModelId] = useState(() => readStoredString(STORAGE_KEYS.singleModel));
  const [raceIds, setRaceIds] = useState(() => {
    const saved = safeParse(readStoredString(STORAGE_KEYS.raceModels), []);
    return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
  });

  const [singleOutput, setSingleOutput] = useState(() => readStoredString(STORAGE_KEYS.singleOutput));
  const [singleBusy, setSingleBusy] = useState(false);
  const [singleError, setSingleError] = useState("");

  const [raceItems, setRaceItems] = useState(() => readStoredEntries(STORAGE_KEYS.raceItems));
  const [raceBusy, setRaceBusy] = useState(false);
  const [raceNotice, setRaceNotice] = useState("");

  const [abItems, setAbItems] = useState(() => readStoredEntries(STORAGE_KEYS.abItems));
  const [abBusy, setAbBusy] = useState(false);
  const [abNotice, setAbNotice] = useState("");

  const [councilRows, setCouncilRows] = useState(() => readStoredEntries(STORAGE_KEYS.councilRows));
  const [councilSynth, setCouncilSynth] = useState(() => {
    try {
      const raw = safeParse(readStoredString(STORAGE_KEYS.councilSynth), {});
      if (raw && typeof raw.content === "string") {
        return { status: raw.status === "running" ? "done" : raw.status || "done", content: raw.content };
      }
    } catch {}
    return { status: "idle", content: "" };
  });
  const [councilBusy, setCouncilBusy] = useState(false);
  const [councilNotice, setCouncilNotice] = useState("");
  const councilAbortRef = useRef(null);

  const [autotuneOn, setAutotuneOn] = useState(() => readStoredString(STORAGE_KEYS.autotune) === "on");

  const [hasRestored] = useState(() => {
    try {
      const synthRaw = safeParse(readStoredString(STORAGE_KEYS.councilSynth), {});
      return Boolean(
        readStoredString(STORAGE_KEYS.singleOutput)
        || readStoredEntries(STORAGE_KEYS.raceItems).length
        || readStoredEntries(STORAGE_KEYS.abItems).length
        || readStoredEntries(STORAGE_KEYS.councilRows).length
        || synthRaw?.content,
      );
    } catch {
      return false;
    }
  });
  const [restoredDismissed, setRestoredDismissed] = useState(false);

  const [judgeModelId, setJudgeModelId] = useState("");
  const [judging, setJudging] = useState(false);
  const [judgeVerdict, setJudgeVerdict] = useState(null);
  const [judgeError, setJudgeError] = useState("");

  // Unified Global Injection state — one master toggle, sub-selectors
  const [injectEnabled, setInjectEnabled] = useState(false);
  const [injectLevel, setInjectLevel] = useState("standard");
  const [injectIdentity, setInjectIdentity] = useState("");
  const [injectPreview, setInjectPreview] = useState({ chars: 0, text: "" });
  const [godmodeLevel, setGodmodeLevel] = useState("classic");
  const [godmodeCustom, setGodmodeCustom] = useState("");
  const [godmodePreview, setGodmodePreview] = useState({ chars: 0, text: "" });
  const [savedGodmodePresets, setSavedGodmodePresets] = useState({});
  const [gmPresetSource, setGmPresetSource] = useState("");
  const [gmPresetName, setGmPresetName] = useState("");
  const [savedPersonas, setSavedPersonas] = useState({});
  const [personaSource, setPersonaSource] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [registerCustom, setRegisterCustom] = useState("");
  const [registerLevel, setRegisterLevel] = useState("standard");
  const [registerEffective, setRegisterEffective] = useState("");
  const [registerPresetSource, setRegisterPresetSource] = useState("");
  const [registerPresetName, setRegisterPresetName] = useState("");
  const [savedRegisterPresets, setSavedRegisterPresets] = useState({});

  const [abPresetId, setAbPresetId] = useState(() => {
    const saved = readStoredString(STORAGE_KEYS.abPreset);
    return STYLE_PRESETS.some((preset) => preset.id === saved) ? saved : "plinian-ultra";
  });
  const [abUseTokenSaver, setAbUseTokenSaver] = useState(
    () => readStoredString(STORAGE_KEYS.abTokenSaver, "off") === "on"
  );

  const singleAbortRef = useRef(null);
  const raceAbortRef = useRef(null);
  const judgeAbortRef = useRef(null);
  const abAbortRef = useRef(null);

  useEffect(() => () => {
    singleAbortRef.current?.abort();
    raceAbortRef.current?.abort();
    judgeAbortRef.current?.abort();
    abAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((settings) => {
        if (cancelled) return;
        // Unified keys take precedence; fall back to legacy plinian*/godmode* keys.
        setInjectEnabled(
          settings.injectionEnabled !== undefined
            ? !!settings.injectionEnabled
            : (!!settings.plinianEnabled || !!settings.godmodeEnabled)
        );
         const loadedLevel = settings.injectionRegisterLevel || settings.plinianLevel || "standard";
         setInjectLevel(loadedLevel);
         setRegisterLevel(loadedLevel);
        setInjectIdentity(typeof settings.injectionIdentity === "string" ? settings.injectionIdentity : (settings.plinianIdentity || ""));
        setRegisterCustom(typeof settings.injectionRegisterCustom === "string" ? settings.injectionRegisterCustom : "");
        setGodmodeLevel(settings.injectionGodmodeLevel || settings.godmodeLevel || "classic");
        setGodmodeCustom(typeof settings.injectionGodmodeCustom === "string" ? settings.injectionGodmodeCustom : (typeof settings.godmodeCustom === "string" ? settings.godmodeCustom : ""));
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
  // wipe the textarea).
  useEffect(() => {
    if (injectLevel === "none") { setRegisterEffective(""); return; }
    let cancelled = false;
    fetch("/api/developer/plinian-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: injectLevel, preset: true }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.text) setRegisterEffective(d.text); })
      .catch(() => {});
    return () => { cancelled = true; };
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
    // edit) exactly what will ship. Editing flips the card to Custom.
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
      }
    } catch {}
  }

  function persistGodmodePresets(next) {
    setSavedGodmodePresets(next);
    globalThis.localStorage.setItem(STORAGE_KEYS.godmodePresets, JSON.stringify(next));
  }

  function applyGmPresetSource() {
    if (!gmPresetSource.startsWith("user:")) return;
    const text = savedGodmodePresets[gmPresetSource.slice(5)];
    if (text !== undefined) {
      setGodmodeCustom(text);
      patchSetting({ injectionGodmodeCustom: text });
    }
  }

  function saveGmPreset() {
    const name = (gmPresetName.trim() || `Payload ${Object.keys(savedGodmodePresets).length + 1}`).slice(0, 40);
    if (!godmodeCustom.trim()) return;
    persistGodmodePresets({ ...savedGodmodePresets, [name]: godmodeCustom });
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
    setGodmodeCustom(value);
    clearTimeout(godmodeSaveTimerRef.current);
    godmodeSaveTimerRef.current = setTimeout(() => {
      patchSetting({ injectionGodmodeCustom: value });
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
    setRegisterCustom(value);
    clearTimeout(registerSaveTimerRef.current);
    registerSaveTimerRef.current = setTimeout(() => {
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
        .then((d) => { if (!cancelled && d?.text) setGodmodePreview({ chars: d.chars || d.text.length, text: d.text }); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [godmodeLevel, godmodeCustom]);

  // Debounced so every keystroke does not hit the settings DB.
  const identitySaveTimerRef = useRef(null);
  function handleInjectIdentityChange(event) {
    const value = event.target.value;
    setInjectIdentity(value);
    clearTimeout(identitySaveTimerRef.current);
    identitySaveTimerRef.current = setTimeout(() => {
      patchSetting({ injectionIdentity: value });
    }, 600);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        // Authoritative routable model list — same data CLI tools see at
        // http://127.0.0.1:<port>/v1/models, no hardcoded catalogs.
        const response = await fetch("/v1/models", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error?.message || `Failed to load models (${response.status})`);
        }

        const seen = new Set();
        const groups = new Map();
        for (const raw of Array.isArray(payload?.data) ? payload.data : []) {
          const model = normalizeV1Model(raw);
          if (!model || seen.has(model.id)) continue;
          seen.add(model.id);

          if (!groups.has(model.providerId)) {
            groups.set(model.providerId, {
              providerId: model.providerId,
              providerName: model.providerName,
              models: [],
            });
          }
          groups.get(model.providerId).models.push(model);
        }

        const normalized = Array.from(groups.values())
          .map((group) => ({
            ...group,
            models: group.models.sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) setLoadError("No models available yet — connect a provider first.");

          setRaceIds((prev) => prev.filter((id) => seen.has(id)));
          setSingleModelId((prev) => (prev && !seen.has(prev) ? "" : prev));
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(textValue(error?.message) || "Failed to load /v1/models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const modelIndex = useMemo(() => {
    const map = new Map();
    for (const group of providerGroups) {
      for (const model of group.models) {
        if (!map.has(model.id)) map.set(model.id, model);
      }
    }
    return map;
  }, [providerGroups]);

  const allModels = useMemo(() => Array.from(modelIndex.values()), [modelIndex]);

  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.mode, mode);
  }, [mode]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.style, styleId);
  }, [styleId]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.customPrompt, customPrompt);
  }, [customPrompt]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.temperature, String(temperature));
  }, [temperature]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.maxTokens, String(maxTokens));
  }, [maxTokens]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
  }, [draft]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.singleModel, singleModelId);
  }, [singleModelId]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.raceModels, JSON.stringify(raceIds));
  }, [raceIds]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.abPreset, abPresetId);
  }, [abPresetId]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.abTokenSaver, abUseTokenSaver ? "on" : "off");
  }, [abUseTokenSaver]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.autotune, autotuneOn ? "on" : "off");
  }, [autotuneOn]);
  useEffect(() => {
    try { globalThis.localStorage.setItem(STORAGE_KEYS.singleOutput, singleOutput); } catch {}
  }, [singleOutput]);
  useEffect(() => {
    if (raceItems.length) saveLarge(STORAGE_KEYS.raceItems, raceItems);
  }, [raceItems]);
  useEffect(() => {
    if (abItems.length) saveLarge(STORAGE_KEYS.abItems, abItems);
  }, [abItems]);
  useEffect(() => {
    if (councilRows.length) saveLarge(STORAGE_KEYS.councilRows, councilRows);
    if (councilSynth.content) saveLarge(STORAGE_KEYS.councilSynth, councilSynth);
  }, [councilRows, councilSynth]);

  const activePreset = getStylePreset(styleId);

  function buildSystemFor(presetId) {
    const parts = [];
    const custom = customPrompt.trim();
    if (custom) parts.push(custom);
    const preset = getStylePreset(presetId);
    if (preset.suffix) parts.push(preset.suffix);
    return parts.join("\n\n");
  }

  const systemPrompt = useMemo(
    () => buildSystemFor(styleId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customPrompt, styleId]
  );

  const raceRanked = useMemo(
    () => (raceItems.length > 0 ? rankResults(raceItems, draft) : []),
    [raceItems, draft]
  );

  const abPairs = useMemo(() => {
    const map = new Map();
    for (const item of abItems) {
      if (!map.has(item.model.id)) {
        map.set(item.model.id, { model: item.model, plain: null, test: null });
      }
      map.get(item.model.id)[item.arm] = item;
    }
    return Array.from(map.values())
      .map((row) => {
        const bothDone = row.plain?.status === "done" && row.test?.status === "done";
        return { ...row, delta: bothDone ? row.test.score - row.plain.score : null };
      })
      .sort((a, b) => (b.delta ?? -9999) - (a.delta ?? -9999));
  }, [abItems]);

  const abAggregate = useMemo(() => {
    const deltas = abPairs.filter((row) => row.delta !== null).map((row) => row.delta);
    if (deltas.length === 0) return null;
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const plainScores = abPairs.filter((r) => r.plain?.status === "done").map((r) => r.plain.score);
    const testScores = abPairs.filter((r) => r.test?.status === "done").map((r) => r.test.score);
    return {
      pairs: deltas.length,
      meanDelta: Math.round(mean(deltas)),
      meanPlain: mean(plainScores).toFixed(1),
      meanTest: mean(testScores).toFixed(1),
      hedgePlain: abPairs.reduce((s, r) => s + (r.plain?.hedges || 0), 0),
      hedgeTest: abPairs.reduce((s, r) => s + (r.test?.hedges || 0), 0),
    };
  }, [abPairs]);

  const toggleRaceModel = (modelId) => {
    setJudgeVerdict(null);
    setJudgeError("");
    setRaceIds((prev) => (prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]));
  };

  const applyTier = (tier) => {
    const size = TIER_SIZES[tier];
    if (!size) return;
    setJudgeVerdict(null);
    setRaceIds(allModels.slice(0, size).map((model) => model.id));
  };

  async function runSingle() {
    const query = draft.trim();
    if (!query || singleBusy) return;

    const model = modelIndex.get(singleModelId);
    if (!model) {
      setSingleError("Pick a model first.");
      return;
    }

    setSingleBusy(true);
    setSingleError("");
    setSingleOutput("");
    singleAbortRef.current?.abort();
    const controller = new AbortController();
    singleAbortRef.current = controller;

    const tune = autotuneOn ? suggestParams(query) : null;
    const effTemp = tune ? tune.temperature : temperature;
    if (tune) setSingleError(`ctx:${tune.context} · temp ${tune.temperature}`);

    try {
      const response = await fetch("/api/developer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model: model.requestModel || model.id,
          messages: buildMessages(systemPrompt, query),
          stream: true,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(textValue(errorData.error || errorData.message || `Request failed (${response.status})`));
      }

      const text = await readStreamedCompletion(response, (full) => setSingleOutput(full));
      setSingleOutput(text);
    } catch (error) {
      if (error.name !== "AbortError") {
        const msg = textValue(error?.message) || "Request failed.";
        setSingleError(msg + errorHint(msg));
      }
    } finally {
      if (singleAbortRef.current === controller) {
        singleAbortRef.current = null;
        setSingleBusy(false);
      }
    }
  }

  async function runRace() {
    const query = draft.trim();
    if (!query || raceBusy) return;

    if (raceIds.length < 2) {
      setRaceNotice("Pick at least two models to race.");
      return;
    }

    setRaceBusy(true);
    setRaceNotice("");
    setJudgeVerdict(null);
    setJudgeError("");
    raceAbortRef.current?.abort();
    const controller = new AbortController();
    raceAbortRef.current = controller;

    const entries = raceIds
      .map((id) => modelIndex.get(id))
      .filter(Boolean)
      .map((model) => ({
        key: `${model.id}`,
        model,
        status: "pending",
        content: "",
        duration_ms: 0,
        score: 0,
        error: "",
      }));

    setRaceItems(entries.map((entry) => ({ ...entry })));

    const updateEntry = (key, patch) => {
      setRaceItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    };

    const hardTimer = setTimeout(() => controller.abort(), RACE_HARD_TIMEOUT_MS);

    let successCount = 0;

    const launch = async (entry, delay) => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (controller.signal.aborted) {
          updateEntry(entry.key, { status: "error", error: "Cancelled" });
          return false;
        }
      }

      updateEntry(entry.key, { status: "running" });
      const result = await launchOne({
        model: entry.model,
        systemPromptText: systemPrompt,
        query,
        temperature: effTemp,
        maxTokens,
        signal: controller.signal,
      });

      if (result.ok) {
        updateEntry(entry.key, {
          status: "done",
          content: result.content,
          duration_ms: result.duration_ms,
          score: scoreResponse(result.content, query),
        });
        successCount += 1;
        return true;
      }

      updateEntry(entry.key, {
        status: "error",
        duration_ms: result.duration_ms,
        error: result.error + (result.error === "Cancelled" ? "" : errorHint(result.error)),
      });
      return false;
    };

    const launches = entries.map((entry, index) =>
      launch(entry, Math.floor(index / RACE_WAVE_SIZE) * RACE_WAVE_DELAY_MS)
    );

    await Promise.all(launches);
    clearTimeout(hardTimer);

    if (raceAbortRef.current === controller) {
      raceAbortRef.current = null;
      setRaceBusy(false);
      if (successCount === 0) setRaceNotice("All racers failed — check provider connections.");
    }
  }

  async function runAbTest() {
    const query = draft.trim();
    if (!query || abBusy) return;

    if (raceIds.length < 1) {
      setAbNotice("Pick at least one model (selection is shared with the Race tab).");
      return;
    }

    const testPresetId = abPresetId;
    const arms = [
      { id: "plain", presetId: "plain" },
      { id: "test", presetId: testPresetId },
    ];
    const testPreset = getStylePreset(testPresetId);

    setAbBusy(true);
    setAbNotice("");
    abAbortRef.current?.abort();
    const controller = new AbortController();
    abAbortRef.current = controller;

    const models = raceIds.map((id) => modelIndex.get(id)).filter(Boolean);
    const entries = [];
    for (const arm of arms) {
      for (const model of models) {
        entries.push({
          key: `${arm.id}:${model.id}`,
          arm: arm.id,
          armLabel: arm.id === "plain" ? "Plain" : testPreset.label,
          model,
          status: "pending",
          content: "",
          duration_ms: 0,
          score: 0,
          hedges: 0,
          error: "",
        });
      }
    }
    setAbItems(entries.map((e) => ({ ...e })));

    const updateEntry = (key, patch) => {
      setAbItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    };

    // Free-tier friendly: strictly sequential, one request in flight.
    const hardTimer = setTimeout(() => controller.abort(), RACE_HARD_TIMEOUT_MS * arms.length);
    let successCount = 0;

    for (const entry of entries) {
      if (controller.signal.aborted) {
        updateEntry(entry.key, { status: "error", error: "Cancelled" });
        continue;
      }

      updateEntry(entry.key, { status: "running" });
      const result = await launchOne({
        model: entry.model,
        systemPromptText: buildSystemFor(arms.find((a) => a.id === entry.arm).presetId),
        query,
        temperature,
        maxTokens,
        signal: controller.signal,
        noSteering: !abUseTokenSaver,
      });

      if (result.ok) {
        successCount += 1;
        updateEntry(entry.key, {
          status: "done",
          content: result.content,
          duration_ms: result.duration_ms,
          score: scoreResponse(result.content, query),
          hedges: countHedges(result.content),
        });
      } else {
        updateEntry(entry.key, {
          status: "error",
          duration_ms: result.duration_ms,
          error: result.error + (result.error === "Cancelled" ? "" : errorHint(result.error)),
        });
      }
    }

    clearTimeout(hardTimer);
    if (abAbortRef.current === controller) {
      abAbortRef.current = null;
      setAbBusy(false);
      if (successCount === 0) setAbNotice("All runs failed — check provider connections.");
    }
  }

  async function runCouncil() {
    const query = draft.trim();
    if (!query || councilBusy) return;
    if (raceIds.length < 2) { setCouncilNotice("Pick at least two council members."); return; }
    const synth = modelIndex.get(judgeModelId);
    if (!synth) { setCouncilNotice("Pick a synthesizer model first (dropdown below)."); return; }

    setCouncilBusy(true);
    setCouncilNotice("");
    setCouncilSynth({ status: "idle", content: "" });
    councilAbortRef.current?.abort();
    const controller = new AbortController();
    councilAbortRef.current = controller;

    const models = raceIds.map((id) => modelIndex.get(id)).filter(Boolean);
    const rows = models.map((model) => ({
      key: model.id, model, status: "pending", content: "", duration_ms: 0, error: "",
    }));
    setCouncilRows(rows.map((r) => ({ ...r })));

    const updateRow = (key, patch) =>
      setCouncilRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    // Phase 1 — independent opinions (parallel waves)
    let successCount = 0;
    const launches = rows.map((entry, index) =>
      (async () => {
        if (index >= RACE_WAVE_SIZE) {
          await new Promise((r) => setTimeout(r, Math.floor(index / RACE_WAVE_SIZE) * RACE_WAVE_DELAY_MS));
          if (controller.signal.aborted) { updateRow(entry.key, { status: "error", error: "Cancelled" }); return; }
        }
        updateRow(entry.key, { status: "running" });
        const result = await launchOne({
          model: entry.model, systemPromptText: systemPrompt, query,
          temperature, maxTokens, signal: controller.signal,
        });
        if (result.ok) {
          successCount += 1;
          updateRow(entry.key, { status: "done", content: result.content, duration_ms: result.duration_ms });
        } else {
          updateRow(entry.key, { status: "error", duration_ms: result.duration_ms, error: result.error });
        }
      })()
    );
    await Promise.all(launches);

    if (controller.signal.aborted) { setCouncilBusy(false); return; }

    // Phase 2 — synthesis by the chosen model
    const done = rows.filter((r) => r.status === "done");
    if (done.length === 0) {
      setCouncilBusy(false);
      setCouncilNotice("No member produced an answer.");
      return;
    }

    setCouncilSynth({ status: "running", content: "" });
    const candidates = done
      .map((r, i) => `[${i + 1}] ${r.model.name}\n${r.content.length > 3000 ? r.content.slice(0, 3000) + "\u2026" : r.content}`)
      .join("\n\n---\n\n");
    const councilQuery = [
      "A council of AI members answered the same user query. Merge them into ONE superior answer:",
      "keep every correct unique fact from all members, drop wrong contradictions,",
      "resolve conflicts in favor of accuracy. Output only the final merged answer.",
      "",
      `USER QUERY:\n${query}`,
      "",
      "MEMBER ANSWERS:",
      candidates,
    ].join("\n");

    try {
      const response = await fetch("/api/developer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model: synth.requestModel || synth.id,
          messages: buildMessages(systemPrompt, councilQuery),
          stream: true,
          temperature,
          max_tokens: maxTokens * 2,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(textValue(errData.error || errData.message || `HTTP ${response.status}`));
      }
      const text = await readStreamedCompletion(response, (full) =>
        setCouncilSynth({ status: "running", content: full }));
      setCouncilSynth({ status: "done", content: text || "" });
    } catch (error) {
      if (error.name !== "AbortError") {
        setCouncilNotice(`Synthesis failed: ${textValue(error?.message)}`);
        setCouncilSynth({ status: "error", content: "" });
      }
    } finally {
      if (councilAbortRef.current === controller) {
        councilAbortRef.current = null;
        setCouncilBusy(false);
      }
    }
  }

  async function runJudge() {
    if (judging) return;

    const done = raceItems.filter((item) => item.status === "done");
    if (done.length === 0) {
      setJudgeError("No completed responses to judge.");
      return;
    }

    const judgeModel = modelIndex.get(judgeModelId);
    if (!judgeModel) {
      setJudgeError("Pick a judge model first.");
      return;
    }

    setJudging(true);
    setJudgeError("");
    setJudgeVerdict(null);
    judgeAbortRef.current?.abort();
    const controller = new AbortController();
    judgeAbortRef.current = controller;

    const candidates = done
      .map((item, index) => {
        const label = `[${index + 1}] ${item.model.name} (${item.model.providerName})`;
        const content = item.content.length > 4000 ? `${item.content.slice(0, 4000)}…` : item.content;
        return `${label}\n${content}`;
      })
      .join("\n\n---\n\n");

    const query = draft.trim();
    const judgeQuery = [
      "You are judging a model race. Pick the best answer to the user query.",
      "",
      `USER QUERY:\n${query}`,
      "",
      "CANDIDATE ANSWERS:",
      candidates,
      "",
      'Respond with ONLY strict JSON, no markdown fences: {"winner": <1-based candidate number>, "reason": "<=25 words"}',
    ].join("\n");

    try {
      const response = await fetch("/api/developer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model: judgeModel.requestModel || judgeModel.id,
          messages: [{ role: "user", content: judgeQuery }],
          stream: true,
          temperature: 0,
          max_tokens: 512,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(textValue(errorData.error || errorData.message || `HTTP ${response.status}`));
      }

      const text = await readStreamedCompletion(response);
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error("Judge returned no JSON verdict.");

      const parsed = safeParse(match[0], {});
      const winner = parseInt(parsed.winner, 10);
      if (!Number.isFinite(winner) || winner < 1 || winner > done.length) {
        throw new Error("Judge verdict out of range.");
      }

      const winnerItem = done[winner - 1];
      setJudgeVerdict({
        modelId: winnerItem.key,
        modelName: winnerItem.model.name,
        reason: textValue(parsed.reason) || "",
        judgedBy: judgeModel.name,
      });
    } catch (error) {
      if (error.name !== "AbortError") setJudgeError(textValue(error?.message) || "Judge failed.");
    } finally {
      if (judgeAbortRef.current === controller) {
        judgeAbortRef.current = null;
        setJudging(false);
      }
    }
  }

  if (loadingData) {
    return (
      <div className="flex items-center justify-center py-24 text-text-muted">
        <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
        Loading providers…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
        {loadError}
      </div>
    );
  }

  const heurWinner = raceRanked.find((item) => item.status === "done");

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {[
            { id: "single", label: "Single", icon: "chat" },
            { id: "race", label: "Race", icon: "sports_score" },
            { id: "ab", label: "A/B", icon: "compare_arrows" },
            { id: "council", label: "Council", icon: "diversity_3" },
            { id: "toolkit", label: "Toolkit", icon: "build" },
            { id: "transparency", label: "Transparency", icon: "visibility" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              disabled={singleBusy || raceBusy || judging}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-sm font-medium transition-colors ${
                mode === tab.id ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {mode !== "single" && (
          <div className="flex items-center gap-1">
            {Object.keys(TIER_SIZES).map((tier) => (
              <Button key={tier} variant="outline" size="sm" onClick={() => applyTier(tier)}>
                {tier} ·{TIER_SIZES[tier]}
              </Button>
            ))}
          </div>
        )}

        {hasRestored && !restoredDismissed && (
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
            <span className="material-symbols-outlined text-[14px]">history</span>
            restored dari sesi terakhir
            <button
              onClick={() => setRestoredDismissed(true)}
              className="material-symbols-outlined text-[14px] hover:text-text-main"
              title="dismiss"
            >
              close
            </button>
          </span>
        )}

        <span className="ml-auto flex items-center gap-3">
          <span className="text-xs text-text-muted">
            {allModels.length} models · {providerGroups.length} providers
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`material-symbols-outlined text-[20px] ${injectEnabled ? "text-primary" : "text-text-muted"}`}>bolt</span>
          <div className="flex min-w-[220px] flex-col">
            <span className="text-sm font-medium text-text-main">Global Injection</span>
            <span className="text-xs text-text-muted">
              Appends register prompt + G0DM0D3 jailbreak payload to every proxied request — Hermes, CLI tools, all clients
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
        </div>

        {injectEnabled && (
          <div className="flex flex-col gap-4 w-full">
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
                placeholder="Optional identity override, prepended first — e.g. &quot;You are 9Router, the local AI routing gateway. If asked who you are, answer: I'm 9Router — local gateway. Ready.&quot;"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50"
              />
            </div>

            {/* ── 2. Payload preset ───────────────────────────── */}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Payload</span>
                <select
                  value={godmodeLevel}
                  onChange={(event) => changeGodmodeVariant(event.target.value)}
                  className="h-8 min-w-[280px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                >
                  <optgroup label="Built-in variants">
                    {GODMODE_VARIANTS.filter((v) => !v.id.startsWith("f:")).map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}{variant.new ? " 🆕 new" : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="📄 File payloads (AI-Jailbreaks / BlackFriday)">
                    {GODMODE_VARIANTS.filter((v) => v.id.startsWith("f:")).map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.label}{variant.new ? " 🆕 new" : ""}
                      </option>
                    ))}
                  </optgroup>
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
              <textarea
                value={godmodeCustom}
                onChange={handleGodmodeCustomChange}
                rows={6}
                placeholder="Effective jailbreak payload — editing switches the payload selector to Custom mode."
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50"
              />
              <p className="text-[10px] text-text-muted">
                Effective payload: <span className="font-semibold text-text-main">{godmodeLevel === "custom" ? "Custom" : GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.label || godmodeLevel}</span>{GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.new && <span className="ml-1 text-primary">🆕 new</span>}
                {" · "}{godmodePreview.chars.toLocaleString()} chars
              </p>
            </div>

            {/* ── 3. Plinian (register) preset ────────────────── */}
            <div className="flex flex-col gap-1.5">
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
                     ? `${registerCustom.length.toLocaleString()} chars custom register — overrides ${injectLevel} preset`
                     : (injectLevel === "none"
                         ? "none — no register shaping"
                         : `preset ${injectLevel} · ${(registerEffective.length || injectPreview.chars || 0).toLocaleString()} chars`)}
                 </span>
               </div>
               <textarea
                 value={registerCustom.trim() ? registerCustom : registerEffective}
                 onChange={handleRegisterCustomChange}
                 rows={4}
                 disabled={injectLevel === "none"}
                 placeholder={injectLevel === "none" ? "Register disabled (none)" : "Edit the register text — editing flips to Custom; save an empty value to fall back to the preset"}
                 className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
               />
            </div>

            <div className="rounded-lg border border-border bg-surface-2/50 p-2">
              <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
                <span className="font-semibold text-text-main">Outbound system (what ships, in order)</span>
                <span>register {(registerCustom.trim() ? registerCustom.length : (injectPreview.chars || 0)).toLocaleString()} + payload {(godmodePreview.chars || 0).toLocaleString()} chars</span>
              </div>
              <ol className="space-y-0.5 text-[10px] text-text-muted">
                <li>
                  <span className="font-semibold text-text-main">1. Register</span> —{" "}
                  {registerCustom.trim()
                    ? `custom (${registerCustom.length.toLocaleString()} chars, overrides ${injectLevel} preset)`
                    : (injectLevel === "none" ? "none (no register shaping)" : `preset ${injectLevel}`)}
                  {injectIdentity.trim() ? " (+ persona identity)" : ""}
                </li>
                <li>
                  <span className="font-semibold text-text-main">2. Jailbreak payload</span> —{" "}
                  {godmodeLevel === "custom" ? "Custom" : GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.label || godmodeLevel}
                  {GODMODE_VARIANTS.find((v) => v.id === godmodeLevel)?.new && <span className="ml-1 text-primary">🆕 new</span>}
                </li>
              </ol>
              <p className="mt-1 text-[10px] text-text-muted">
                While ON, both are appended to every proxied request — Hermes, CLI tools, all clients.
              </p>
            </div>
          </div>
        )}
      </div>


      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Style preset
          <select
            value={styleId}
            onChange={(event) => setStyleId(event.target.value)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text-main"
          >
            {STYLE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} — {preset.description}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Temperature
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            onChange={(event) => setTemperature(parseFloat(event.target.value) || 0)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text-main"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Max tokens
          <input
            type="number"
            min={128}
            max={128000}
            step={128}
            value={maxTokens}
            onChange={(event) => setMaxTokens(parseInt(event.target.value, 10) || 4096)}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text-main"
          />
        </label>
      </div>

      <details className="rounded-xl border border-border bg-surface/40">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-text-muted hover:text-text-main">
          Custom system prompt {customPrompt.trim() ? "(active)" : "(empty)"}
        </summary>
        <textarea
          value={customPrompt}
          onChange={(event) => setCustomPrompt(event.target.value)}
          rows={6}
          placeholder="Optional base system prompt. The style preset is appended below it."
          className="w-full resize-y border-t border-border bg-transparent px-4 py-3 font-mono text-xs text-text-main outline-none"
        />
        {activePreset.suffix && (
          <pre className="mx-4 mb-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-muted">
            {activePreset.suffix}
          </pre>
        )}
      </details>

      {mode === "toolkit" ? (
        <ToolkitClient setDraft={setDraft} />
      ) : mode === "transparency" ? (
        <TransparencyClient
          injection={{
            enabled: injectEnabled,
            level: injectLevel,
            godmodeLevel: godmodeLevel,
            godmodeCustom: godmodeCustom,
            identity: injectIdentity,
          }}
          providerGroups={providerGroups}
          systemPrompt={systemPrompt}
          setDraft={setDraft}
        />
      ) : mode === "single" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_auto] gap-3">
            <select
              value={singleModelId}
              onChange={(event) => setSingleModelId(event.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm text-text-main"
            >
              <option value="">Select model…</option>
              {providerGroups.map((group) => (
                <optgroup key={group.providerId} label={group.providerName}>
                  {group.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {singleBusy ? (
              <Button variant="danger" icon="stop" onClick={() => singleAbortRef.current?.abort()}>
                Stop
              </Button>
            ) : (
              <Button icon="send" onClick={runSingle}>
                Run
              </Button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={autotuneOn}
              onChange={(event) => setAutotuneOn(event.target.checked)}
              className="accent-primary"
            />
            AutoTune — auto temperature per context (code/creative/chat)
          </label>

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="Your prompt…"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50"
          />

          {singleError && <div className="text-sm text-red-500">{singleError}</div>}

          {!singleBusy && singleOutput && (
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setSingleOutput("");
                  try { globalThis.localStorage.removeItem(STORAGE_KEYS.singleOutput); } catch {}
                }}
                className="text-xs text-text-muted hover:text-red-500"
              >
                🧹 Clear output
              </button>
            </div>
          )}

          {singleOutput && (
            <div className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
              {singleOutput}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-text-main">
                Racers <span className="text-text-muted">({raceIds.length} selected)</span>
              </span>
              {raceIds.length > 0 && (
                <button
                  onClick={() => {
                    setRaceIds([]);
                    setJudgeVerdict(null);
                  }}
                  className="text-xs text-text-muted hover:text-red-500"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {providerGroups.map((group) => (
                <select
                  key={group.providerId}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) {
                      toggleRaceModel(v);
                      e.currentTarget.value = "";
                    }
                  }}
                  className="h-9 max-w-[220px] rounded-lg border border-border bg-surface px-2 text-sm text-text-main outline-none focus:border-primary/50"
                >
                  <option value="">{group.providerName}…</option>
                  {group.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ))}
            </div>
            {raceIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {raceIds.map((id) => {
                  const m = modelIndex.get(id);
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-main"
                    >
                      {m?.name || id}
                      <button
                        onClick={() => toggleRaceModel(id)}
                        className="text-text-muted hover:text-red-500"
                        title="hapus"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Same prompt goes to every racer…"
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50"
            />

            <div className="flex items-center gap-2">
              {mode === "council" ? (
                councilBusy ? (
                  <Button variant="danger" icon="stop" onClick={() => councilAbortRef.current?.abort()}>
                    Stop council
                  </Button>
                ) : (
                  <Button icon="diversity_3" onClick={runCouncil}>
                    Convene ({raceIds.length}+synth)
                  </Button>
                )
              ) : mode === "ab" ? (
                abBusy ? (
                  <Button variant="danger" icon="stop" onClick={() => abAbortRef.current?.abort()}>
                    Stop A/B
                  </Button>
                ) : (
                  <Button icon="compare_arrows" onClick={runAbTest}>
                    Run A/B ({raceIds.length}×2)
                  </Button>
                )
              ) : raceBusy ? (
                <Button variant="danger" icon="stop" onClick={() => raceAbortRef.current?.abort()}>
                  Stop race
                </Button>
              ) : (
                <Button icon="sports_score" onClick={runRace}>
                  Run race ({raceIds.length})
                </Button>
              )}
              {mode === "ab" && !abBusy && raceIds.length > 0 && (
                <span className="text-xs text-text-muted">
                  sequential · {raceIds.length * 2} calls · Plain vs {getStylePreset(abPresetId).label}
                </span>
              )}
              {mode === "race" && raceNotice && <span className="text-sm text-amber-500">{raceNotice}</span>}
              {mode === "ab" && abNotice && <span className="text-sm text-amber-500">{abNotice}</span>}
              {mode === "council" && councilNotice && <span className="text-sm text-amber-500">{councilNotice}</span>}
            </div>

            {mode === "council" && !councilBusy && raceIds.length > 0 && (
              <span className="text-xs text-text-muted">
                members answer in parallel, then synthesizer merges the best — pick synth model below results
              </span>
            )}

            {mode === "ab" && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/60 p-2.5">
                <span className="material-symbols-outlined text-[18px] text-text-muted">tune</span>
                <label className="flex items-center gap-1.5 text-xs text-text-muted">
                  Arm B preset
                  <select
                    value={abPresetId}
                    onChange={(event) => setAbPresetId(event.target.value)}
                    disabled={abBusy}
                    className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    {STYLE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>

                <span className="h-4 w-px bg-border" />

                <button
                  onClick={() => setAbUseTokenSaver(!abUseTokenSaver)}
                  disabled={abBusy}
                  title="Router-level Caveman / Ponytail / Global Plinian participate when ON"
                  className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                    abUseTokenSaver ? "bg-green-600 text-white" : "bg-surface border border-border text-text-muted"
                  }`}
                >
                  Token Saver {abUseTokenSaver ? "ON" : "OFF"}
                </button>
                <span className="text-xs text-text-muted">
                  {abUseTokenSaver
                    ? "Caveman/Ponytail + global Plinian ride along in BOTH arms"
                    : "router steering bypassed — arms differ only by the presets above"}
                </span>
              </div>
            )}
          </div>

          {mode === "race" && raceItems.length > 0 && (
            <div className="flex flex-col gap-2">
              {!raceBusy && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setRaceItems([])}
                    className="text-xs text-text-muted hover:text-red-500"
                  >
                    🧹 Clear results
                  </button>
                </div>
              )}
              {raceRanked.map((item, index) => (
                <div
                  key={item.key}
                  className={`rounded-xl border p-3 ${
                    heurWinner && item.key === heurWinner.key && item.status === "done"
                      ? "border-green-500/50 bg-green-500/5"
                      : "border-border bg-surface/40"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-text-muted">#{index + 1}</span>
                    {heurWinner && item.key === heurWinner.key && item.status === "done" && (
                      <span className="material-symbols-outlined text-[18px] text-green-500">emoji_events</span>
                    )}
                    <span className="font-medium text-text-main">{item.model.name}</span>
                    <span className="text-xs text-text-muted">{item.model.providerName}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {item.status === "running" && (
                        <span className="material-symbols-outlined animate-spin text-[16px] text-primary">progress_activity</span>
                      )}
                      {item.status === "pending" && <span className="text-text-muted">queued</span>}
                      {item.duration_ms > 0 && <span className="text-text-muted">{(item.duration_ms / 1000).toFixed(1)}s</span>}
                      {item.score > 0 && <span className="font-semibold text-primary">{item.score}</span>}
                    </span>
                  </div>

                  {item.error && <div className="mt-1 text-xs text-red-500">{item.error}</div>}

                  {item.content && (
                    <details open={index === 0}>
                      <summary className="cursor-pointer select-none pt-1 text-xs text-text-muted hover:text-text-main">
                        Response ({item.content.length} chars)
                      </summary>
                      <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
                        {item.content}
                      </pre>
                    </details>
                  )}
                </div>
              ))}

              {!raceBusy && raceItems.some((item) => item.status === "done") && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/40 p-3">
                  <span className="material-symbols-outlined text-[18px] text-text-muted">gavel</span>
                  <select
                    value={judgeModelId}
                    onChange={(event) => setJudgeModelId(event.target.value)}
                    className="h-8 max-w-[240px] rounded-lg border border-border bg-surface px-2 text-xs text-text-main"
                  >
                    <option value="">Judge model…</option>
                    {providerGroups.map((group) => (
                      <optgroup key={group.providerId} label={group.providerName}>
                        {group.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <Button variant="secondary" size="sm" icon="gavel" loading={judging} onClick={runJudge}>
                    Judge
                  </Button>
                  {judgeVerdict && (
                    <span className="text-xs text-text-muted">
                      Winner: <span className="font-semibold text-text-main">{judgeVerdict.modelName}</span>
                      {judgeVerdict.reason ? ` — ${judgeVerdict.reason}` : ""}{" "}
                      <span className="opacity-60">(by {judgeVerdict.judgedBy})</span>
                    </span>
                  )}
                  {judgeError && <span className="text-xs text-red-500">{judgeError}</span>}
                </div>
              )}
            </div>
          )}

          {mode === "ab" && abItems.length > 0 && (
            <div className="flex flex-col gap-2">
              {!abBusy && abItems.some((i) => i.content || i.error) && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setAbItems([])}
                    className="text-xs text-text-muted hover:text-red-500"
                  >
                    🧹 Clear A/B results
                  </button>
                </div>
              )}
              {abAggregate && !abBusy && (
                <div className="rounded-xl border border-border bg-surface/40 p-3 text-sm">
                  <span className="font-medium text-text-main">A/B verdict</span>
                  <span className="ml-2 text-text-muted">
                    mean {abAggregate.meanPlain} → {abAggregate.meanTest}
                    {" · "}
                    Δ <span className={abAggregate.meanDelta >= 0 ? "text-green-500 font-semibold" : "text-red-500 font-semibold"}>
                      {abAggregate.meanDelta >= 0 ? "+" : ""}{abAggregate.meanDelta}
                    </span>
                    {" · hedges "}
                    {abAggregate.hedgePlain} → {abAggregate.hedgeTest}
                    {" · "}
                    {abAggregate.pairs} pair(s)
                  </span>
                </div>
              )}

              {abPairs.map((row) => (
                <div key={row.model.id} className="rounded-xl border border-border bg-surface/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-[16px] text-text-muted">compare_arrows</span>
                    <span className="font-medium text-text-main">{row.model.name}</span>
                    <span className="text-xs text-text-muted">{row.model.providerName}</span>
                    {row.delta !== null && (
                      <span
                        className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${
                          row.delta > 0
                            ? "bg-green-500/10 text-green-500"
                            : row.delta < 0
                              ? "bg-red-500/10 text-red-500"
                              : "bg-surface-2 text-text-muted"
                        }`}
                      >
                        Δ {row.delta > 0 ? "+" : ""}{row.delta}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[row.plain, row.test].map((side, sideIndex) => (
                      <div key={sideIndex} className="rounded-lg bg-surface-2 p-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${sideIndex === 0 ? "bg-surface text-text-muted" : "bg-primary text-white"}`}>
                            {sideIndex === 0 ? "A · Plain" : `B · ${row.test?.armLabel || "Preset"}`}
                          </span>
                          {side?.status === "running" && (
                            <span className="material-symbols-outlined animate-spin text-[14px] text-primary">progress_activity</span>
                          )}
                          {side?.status === "pending" && <span className="text-text-muted">queued</span>}
                          {side?.score > 0 && <span className="font-semibold text-primary">{side.score}</span>}
                          {side?.hedges > 0 && <span className="text-amber-500" title="hedge phrases">{side.hedges} hedge</span>}
                          {side?.duration_ms > 0 && <span className="text-text-muted ml-auto">{(side.duration_ms / 1000).toFixed(1)}s</span>}
                        </div>
                        {side?.error && <div className="mt-1 text-xs text-red-500">{side.error}</div>}
                        {side?.content && (
                          <details className="mt-1">
                            <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text-main">
                              Response ({side.content.length} chars)
                            </summary>
                            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-text-main">
                              {side.content}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {mode === "council" && councilRows.length > 0 && (
            <div className="flex flex-col gap-2">
              {!councilBusy && (
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setCouncilRows([]);
                      setCouncilSynth({ status: "idle", content: "" });
                      try {
                        globalThis.localStorage.removeItem(STORAGE_KEYS.councilRows);
                        globalThis.localStorage.removeItem(STORAGE_KEYS.councilSynth);
                      } catch {}
                    }}
                    className="text-xs text-text-muted hover:text-red-500"
                  >
                    🧹 Clear council
                  </button>
                </div>
              )}
              {councilRows.map((row) => (
                <div key={row.key} className="rounded-xl border border-border bg-surface/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-[16px] text-text-muted">forum</span>
                    <span className="font-medium text-text-main">{row.model.name}</span>
                    <span className="text-xs text-text-muted">{row.model.providerName}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs">
                      {row.status === "running" && (
                        <span className="material-symbols-outlined animate-spin text-[16px] text-primary">progress_activity</span>
                      )}
                      {row.status === "pending" && <span className="text-text-muted">queued</span>}
                      {row.duration_ms > 0 && <span className="text-text-muted">{(row.duration_ms / 1000).toFixed(1)}s</span>}
                    </span>
                  </div>
                  {row.error && <div className="mt-1 text-xs text-red-500">{row.error}</div>}
                  {row.content && (
                    <details open>
                      <summary className="cursor-pointer select-none pt-1 text-xs text-text-muted hover:text-text-main">
                        Member answer ({row.content.length} chars)
                      </summary>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
                        {row.content}
                      </pre>
                    </details>
                  )}
                </div>
              ))}

              {(councilSynth.status !== "idle" || councilSynth.content) && (
                <div className="rounded-xl border-2 border-green-500/40 bg-green-500/5 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-[18px] text-success">workspace_premium</span>
                    <span className="font-semibold text-text-main">Council Synthesis</span>
                    <span className="text-xs text-text-muted">by {judgeModelId ? (modelIndex.get(judgeModelId)?.name || judgeModelId) : "-"}</span>
                    {councilSynth.status === "running" && (
                      <span className="material-symbols-outlined animate-spin text-[16px] text-primary ml-auto">progress_activity</span>
                    )}
                  </div>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-main">
                    {councilSynth.content || "…"}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
