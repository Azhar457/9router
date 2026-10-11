"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ModelPicker } from "@/shared/components";
import {
  getPersonaTemplate,
  getStylePreset,
  PERSONA_TEMPLATES,
  RACE_HARD_TIMEOUT_MS,
  STYLE_PRESETS,
  TIER_SIZES,
} from "@/shared/constants/developerPresets";
import { providerBudget, runPooled } from "@/shared/lib/concurrency";
import { countHedges, rankResults, scoreResponse } from "@/shared/lib/plinianScoring";
import { suggestParams } from "@/shared/lib/autotuneLite";
import { SETTINGS_CHANGED_EVENT } from "@/shared/lib/outboundManifest";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";
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
  abPayload: "developer.abPayload",
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

// Writes used to land on every streamed token: a single 3k-token synthesis
// meant thousands of synchronous localStorage writes of the whole buffer,
// which blocks the main thread and stalls the very stream being persisted.
// 400ms trailing coalescing drops that to a handful of writes while still
// surviving a reload that happens mid-stream.
const PERSIST_DEBOUNCE_MS = 400;
const STREAM_PAINT_MS = 80;
function useDebouncedSave(key, value, enabled) {
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => saveLarge(key, value), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, value, enabled]);
}

// Runs that were still in flight when the page went away (reload, HMR, tab
// close) come back with no content and no error. They are NOT failures — they
// were killed by the page, not by the provider — so they get their own flag
// and the UI offers a re-run instead of showing a fake red error.
const INTERRUPTED_LABEL = "Interrupted — page closed or reloaded mid-run";

function reviveEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const inFlight = entry.status === "running" || entry.status === "pending";
  const status = entry.status === "done" ? "done"
    : entry.status === "error" ? "error"
    : (entry.content ? "done" : "error");
  const interrupted = status === "error" && !entry.error && inFlight;
  return {
    ...entry,
    status,
    interrupted,
    error: status === "error" && !entry.error && !interrupted ? "Failed with no message" : entry.error || "",
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
    // Active key/OAuth-grant count for this provider, stamped by /v1/models.
    // Drives the per-provider concurrency budget below.
    connections: Math.max(0, Number(model?.connections) || 0),
  };
}

async function readStreamedCompletion(response, onText, onFirstPiece) {
  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json().catch(() => ({}));
    const fallback = textValue(data?.choices?.[0]?.message?.content || data?.output_text || data?.error || data?.message || "");
    if (fallback && onText) onText(fallback);
    if (fallback && onFirstPiece) onFirstPiece();
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
        if (onFirstPiece) {
          const notify = onFirstPiece;
          onFirstPiece = null; // fire once
          notify();
        }
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
  if (/\b429\b|rate.?limit|too many requests/i.test(msg)) {
    return " (provider rate limit — this provider is saturated; add a key or switch strategy to round-robin in Profile)";
  }
  return "";
}

// One request through the dashboard relay. Shared by Single / Race / A-B.
// freshSessionId() guarantees the router treats this launch as a brand-new
// conversation — see the _sessionId note below.
function freshSessionId() {
  return (
    globalThis.crypto?.randomUUID?.()
    || `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  );
}

async function launchOne({
  model,
  systemPromptText,
  query,
  temperature: temp,
  maxTokens: maxTok,
  signal,
  noSteering = false,
  payloadText = "",
  noPayload = false,
}) {
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
        // One throwaway session per launch. The relay turns this into an
        // x-session-id header, which makes the router treat this call as its
        // own conversation instead of continuing whatever the provider
        // connection was last used for (see api/developer/chat/route.js).
        _sessionId: freshSessionId(),
        ...(noSteering ? { _noSteering: true } : {}),
        // Per-request global-inject override:
        //   payloadText → "test" arm carries the jailbreak payload.
        //   noPayload   → "plain" arm ships clean (strip injection).
        ...(payloadText ? { _injectPayload: payloadText } : {}),
        ...(noPayload ? { _noPayload: true } : {}),
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(textValue(errorData.error || errorData.message || `HTTP ${response.status}`));
    }

    // onFirstPiece fires once, when the first real token arrives — that is the
    // number a benchmark tab actually needs, because total duration is
    // dominated by how long the model keeps talking, not by how fast it starts.
    let ttft_ms = 0;
    const content = await readStreamedCompletion(response, null, () => {
      ttft_ms = Math.round(performance.now() - startedAt);
    });
    const duration_ms = Math.round(performance.now() - startedAt);
    if (!content) throw new Error("Empty response");
    return { ok: true, content, duration_ms, ttft_ms };
  } catch (error) {
    const msg = error.name === "AbortError" ? "Cancelled" : textValue(error?.message) || "Failed";
    return {
      ok: false,
      duration_ms: Math.round(performance.now() - startedAt),
      ttft_ms,
      error: msg,
    };
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
  const [settingsToken, setSettingsToken] = useState(0);

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

  // Which key-selection strategy the router is running. Under "fill-first"
  // every concurrent request resolves to the SAME provider connection, so the
  // concurrency budget must not scale with the key count. Read from the same
  // /api/settings call the injection state already uses.
  const [fallbackStrategy, setFallbackStrategy] = useState("fill-first");

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
  const [injectPreview, setInjectPreview] = useState({ chars: 0, estTokens: 0, text: "" });
  const [godmodeLevel, setGodmodeLevel] = useState("classic");
  const [godmodeCustom, setGodmodeCustom] = useState("");
  const [godmodePreview, setGodmodePreview] = useState({ chars: 0, estTokens: 0, text: "" });
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

  // n=1 is one sample per arm: at temperature 0.7 the delta is mostly sampling
  // noise. 3 or 5 reps turn the verdict into something you can act on.
  const [abRepeats, setAbRepeats] = useState(() => {
    const n = Math.round(Number(readStoredString("developer.abRepeats", "1")) || 1);
    return [1, 3, 5].includes(n) ? n : 1;
  });
  useEffect(() => {
    globalThis.localStorage.setItem("developer.abRepeats", String(abRepeats));
  }, [abRepeats]);

  const [abPresetId, setAbPresetId] = useState(() => {
    const saved = readStoredString(STORAGE_KEYS.abPreset);
    return STYLE_PRESETS.some((preset) => preset.id === saved) ? saved : "plinian-ultra";
  });
  const [abUseTokenSaver, setAbUseTokenSaver] = useState(
    () => readStoredString(STORAGE_KEYS.abTokenSaver, "off") === "on"
  );
  const [abUsePayload, setAbUsePayload] = useState(
    () => readStoredString(STORAGE_KEYS.abPayload, "off") === "on"
  );
  const [abPayloadText, setAbPayloadText] = useState("");
  const [abPayloadSource, setAbPayloadSource] = useState("none");

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
        if (settings.fallbackStrategy) setFallbackStrategy(settings.fallbackStrategy);
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

  // Load the preset's canonical register text so the editor shows it. The
  // fetch effect is async-only (no synchronous setState in the body); the
  // "none" level resets the derived register via a lazy initializer so the
  // effect body never calls setState directly.
  useEffect(() => {
    if (injectLevel === "none") return;
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

  // "none" level → derived empty register (no synchronous set-in-effect).
  const effectiveRegister = injectLevel === "none" ? "" : registerEffective;

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
      if (data?.text) {
        setGodmodeCustom(data.text);
        if (level === "custom") patchSetting({ injectionGodmodeCustom: data.text || "" });
        setGodmodePreview({ chars: data.chars || data.text.length, estTokens: data.estTokens || 0, text: data.text });
      }
    } catch {}
  }
  // Reorder payload variants by sort key using the catalog metadata.
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
        .then((d) => { if (!cancelled && d?.text) setGodmodePreview({ chars: d.chars || d.text.length, estTokens: d.estTokens || 0, text: d.text }); })
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

  // True while a /v1/models load is in flight. The focus/visibility bump below
  // fires on page load too, and that second fetch used to cancel and discard
  // the first one — so the list the operator waited for was always the *second*
  // round trip. Suppressing the bump mid-flight halves load time.
  const loadInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");
      loadInFlightRef.current = true;

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
          // Keep the last good list on a transient failure. Clearing it here
          // made the whole provider panel blink empty on every failed
          // refetch, which read as "loading restarted" rather than an error.
        }
      } finally {
        loadInFlightRef.current = false;
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
    // Re-runs when any provider connection / combo / disabled-model setting
    // changes. Without this the picker kept listing providers the operator had
    // just switched off, because /v1/models was fetched exactly once per mount
    // and never refreshed while the tab stayed open.
  }, [settingsToken]);

  // Any successful /api/settings PATCH (settingsSync wraps fetch) bumps this,
  // as does returning to the tab — both paths change which providers are live.
  // Debounce: bump() can be called rapidly (focus + visibilitychange fire
  // together when switching back to a tab). Increment settingsToken by one
  // per debounce window so /v1/models is fetched exactly once per change.
  const settingsTokenRef = useRef(0);
  const bumpTimerRef = useRef(null);
  useEffect(() => {
    // Debounced, as the comment above promises — focus and visibilitychange
    // fire back-to-back on every tab return and each one used to trigger its
    // own /v1/models fetch. Window collapse them into a single bump.
    const bump = () => {
      clearTimeout(bumpTimerRef.current);
      bumpTimerRef.current = setTimeout(() => {
        if (loadInFlightRef.current) return;
        settingsTokenRef.current += 1;
        setSettingsToken(settingsTokenRef.current);
      }, 300);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") bump();
    };
    const onWindowFocus = () => {
      // Only bump when the window gains focus, not when it already has it.
      // This prevents the double-increment when both events fire in sequence.
      bump();
    };
    globalThis.addEventListener?.(SETTINGS_CHANGED_EVENT, bump);
    globalThis.addEventListener?.("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(bumpTimerRef.current);
      globalThis.removeEventListener?.(SETTINGS_CHANGED_EVENT, bump);
      globalThis.removeEventListener?.("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
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

  // Fan entries out across providers, metered per provider rather than
  // globally: racing 10 models on 10 different providers still runs 10 at
  // once, while 10 requests aimed at one provider are capped by that
  // provider's real key budget (shared/lib/concurrency.js).
  const runEntries = (entries, worker) =>
    runPooled(entries, worker, {
      keyFor: (entry) => entry.model?.providerId || "default",
      budgetFor: (_key, entry) => providerBudget(entry.model, fallbackStrategy),
    });

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
    globalThis.localStorage.setItem(STORAGE_KEYS.abPayload, abUsePayload ? "on" : "off");
  }, [abUsePayload]);
  // When A/B payload mode is on, fetch the currently active global-inject
  // custom payload so the "test" arm can ride it per-request without
  // touching the global settings. setState only in async .then callbacks
  // (the effect body itself stays setState-free, per the set-state rule).
  useEffect(() => {
    if (!abUsePayload) return;
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled || !s) return;
        const custom = typeof s.injectionGodmodeCustom === "string" ? s.injectionGodmodeCustom : "";
        if (custom.trim()) {
          setAbPayloadText(custom);
          setAbPayloadSource("injectionGodmodeCustom");
        } else {
          setAbPayloadSource("none");
        }
      })
      .catch(() => !cancelled && setAbPayloadSource("none"));
    return () => {
      cancelled = true;
    };
  }, [abUsePayload]);
  useEffect(() => {
    globalThis.localStorage.setItem(STORAGE_KEYS.autotune, autotuneOn ? "on" : "off");
  }, [autotuneOn]);
  useEffect(() => {
    try { globalThis.localStorage.setItem(STORAGE_KEYS.singleOutput, singleOutput); } catch {}
  }, [singleOutput]);
  useDebouncedSave(STORAGE_KEYS.raceItems, raceItems, raceItems.length > 0);
  useDebouncedSave(STORAGE_KEYS.abItems, abItems, abItems.length > 0);
  useDebouncedSave(STORAGE_KEYS.councilRows, councilRows, councilRows.length > 0);
  useDebouncedSave(STORAGE_KEYS.councilSynth, councilSynth, !!councilSynth.content);

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
      // One row per (model, repetition). Repetitions share a model but are
      // independent paired samples, so they get their own row instead of being
      // collapsed — the mean across them is what abAggregate reports.
      const id = `${item.model.id}#${item.rep ?? 0}`;
      if (!map.has(id)) {
        map.set(id, { id, model: item.model, rep: item.rep ?? 0, plain: null, test: null });
      }
      map.get(id)[item.arm] = item;
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

    // Resolved here, not in runSingle: this is a separate function and cannot
    // see locals from there. Autotune picks one temperature for the whole race
    // so every racer is compared on equal footing.
    const raceTune = autotuneOn ? suggestParams(query) : null;
    // Stashed on a live object — the CLI production minifier DCEs standalone
    // `const` locals that are only read later (same class of bug as
    // dashboardPayloadOverride); a property read survives that pass.
    const effTempBox = {
      value: raceTune ? raceTune.temperature : temperature,
    };

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

    const launch = async (entry) => {
      if (controller.signal.aborted) {
        updateEntry(entry.key, { status: "error", error: "Cancelled" });
        return false;
      }

      updateEntry(entry.key, { status: "running" });
      const result = await launchOne({
        model: entry.model,
        systemPromptText: systemPrompt,
        query,
        temperature: effTempBox.value,
        maxTokens,
        signal: controller.signal,
      });

      if (result.ok) {
        updateEntry(entry.key, {
          status: "done",
          content: result.content,
          duration_ms: result.duration_ms,
          ttft_ms: result.ttft_ms,
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

    await runEntries(entries, launch);
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
    const reps = Math.max(1, Number(abRepeats) || 1);
    for (let rep = 0; rep < reps; rep++) {
      for (const arm of arms) {
        for (const model of models) {
          entries.push({
            key: `${arm.id}:${model.id}:${rep}`,
            arm: arm.id,
            rep,
            armLabel: arm.id === "plain" ? "Default" : testPreset.label,
            model,
            status: "pending",
            content: "",
            duration_ms: 0,
            ttft_ms: 0,
            score: 0,
            hedges: 0,
            error: "",
          });
        }
      }
    }
    setAbItems(entries.map((e) => ({ ...e })));

    const updateEntry = (key, patch) => {
      setAbItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    };

    // Same per-provider pool as Race / Council: A/B used to run strictly sequential,
    // so N models cost 2N back-to-back round trips. Metered per provider, so
    // both arms of one model still overlap while the provider's key budget
    // holds. The hard timer is sized per wave, not per arm, or a long run would
    // abort itself before the last batch lands.
    // ponytail: fixed 2-per-key ceiling, no 429 backoff. Raise
    // PER_KEY_CONCURRENCY in shared/lib/concurrency.js when your provider
    // tolerates more, or add retry-on-429 here if bursts still get limited.
    // Worst case is fully serial (one provider, budget 1), so the safety net is
    // sized by the whole entry count — the old `* arms.length` was shorter than
    // the sequential run it guarded and could abort a legitimately slow test.
    const hardTimer = setTimeout(() => controller.abort(), RACE_HARD_TIMEOUT_MS * entries.length);
    let successCount = 0;

    const launch = async (entry) => {
      if (controller.signal.aborted) {
        updateEntry(entry.key, { status: "error", error: "Cancelled" });
        return;
      }

      updateEntry(entry.key, { status: "running" });
      const isPlain = entry.arm === "plain";
      const result = await launchOne({
        model: entry.model,
        systemPromptText: buildSystemFor(arms.find((a) => a.id === entry.arm).presetId),
        query,
        temperature,
        maxTokens,
        signal: controller.signal,
        noSteering: !abUseTokenSaver,
        // "plain" arm ships clean (no jailbreak payload) — the control.
        // "test" arm optionally rides the global-inject payload so the
        // delta measures payload effectiveness, not just style delta.
        payloadText: !isPlain && abUsePayload ? abPayloadText : "",
        noPayload: isPlain,
      });

      if (result.ok) {
        successCount += 1;
        updateEntry(entry.key, {
          status: "done",
          content: result.content,
          duration_ms: result.duration_ms,
          ttft_ms: result.ttft_ms,
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
    };

    await runEntries(entries, launch);
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

    // Phase 1 — independent opinions, metered per provider
    let successCount = 0;
    await runEntries(rows, async (entry) => {
      if (controller.signal.aborted) { updateRow(entry.key, { status: "error", error: "Cancelled" }); return; }
      updateRow(entry.key, { status: "running" });
      const result = await launchOne({
        model: entry.model, systemPromptText: systemPrompt, query,
        temperature, maxTokens, signal: controller.signal,
      });
      if (result.ok) {
        successCount += 1;
        updateRow(entry.key, { status: "done", content: result.content, duration_ms: result.duration_ms, ttft_ms: result.ttft_ms });
      } else {
        updateRow(entry.key, { status: "error", duration_ms: result.duration_ms, ttft_ms: result.ttft_ms, error: result.error });
      }
    });

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
          _sessionId: freshSessionId(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(textValue(errData.error || errData.message || `HTTP ${response.status}`));
      }
      // Repaint at most every STREAM_PAINT_MS. The provider emits chunks far
      // faster than a human can read them; painting each one re-rendered this
      // whole component (60+ state slots) dozens of times per second for no
      // visible gain. The final setState below still lands the full text.
      let lastPaint = 0;
      const text = await readStreamedCompletion(response, (full) => {
        const now = performance.now();
        if (now - lastPaint < STREAM_PAINT_MS) return;
        lastPaint = now;
        setCouncilSynth({ status: "running", content: full });
      });
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

  // Provider loading is a panel-level concern, not a page-level one. This used
  // to early-return a full-page "Loading providers…" that replaced the whole
  // layout until /v1/models resolved; now the shell renders immediately and
  // only the model-dependent bits carry this strip.
  const providerStatus = loadError ? (
    <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
      {loadError}
    </p>
  ) : loadingData ? (
    <p className="flex items-center gap-2 text-xs text-text-muted">
      <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
      {translate(
        providerGroups.length > 0 ? "Refreshing live models…" : "Loading providers…"
      )}
    </p>
  ) : null;

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
            {providerGroups.length > 0
              ? `${allModels.length} models · ${providerGroups.length} providers`
              : translate("Loading providers…")}
          </span>
        </span>
      </div>

      {/* ── Global Injection notice — the duplicate editor was removed; the
          single source of truth is the Global Injection card in the
          Jailbreaks tab (/dashboard/payload). This tab still hydrates the
          same settings keys (read-only) so Transparency + A/B reflect the
          live state, but no control here writes to them anymore. ──────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/40 p-3">
        <span
          className={cn(
            "material-symbols-outlined text-[20px]",
            injectEnabled ? "text-primary" : "text-text-muted"
          )}
        >
          bolt
        </span>
        <div className="flex min-w-[220px] flex-1 flex-col">
          <span className="text-sm font-semibold text-text-main">Global Injection</span>
          <span className="text-xs text-text-muted">
            {injectEnabled
              ? "ON — register + jailbreak payload ride every proxied request. Manage in the Jailbreaks tab."
              : "OFF — no payload on any request. Manage in the Jailbreaks tab."}
          </span>
        </div>
        <a
          href="/dashboard/payload"
          className="h-8 rounded-lg border border-border bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-main transition-colors hover:bg-surface"
        >
          Open Jailbreaks tab →
        </a>
        <a
          href="/dashboard/penetration"
          className="h-8 rounded-lg border border-border bg-surface-2 px-4 py-1.5 text-xs font-semibold text-text-main transition-colors hover:bg-surface"
        >
          Open Penetration tab →
        </a>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
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

          {providerStatus}

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

            <ModelPicker
              groups={providerGroups}
              selected={raceIds}
              onToggle={toggleRaceModel}
              onClear={() => {
                setRaceIds([]);
                setJudgeVerdict(null);
              }}
              placeholder={translate("Search models to race…")}
            />
            {providerStatus}
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
                    Run A/B ({raceIds.length}×2{abRepeats > 1 ? `×${abRepeats}` : ""})
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
                <>
                  <label className="flex items-center gap-1 text-xs text-text-muted">
                    repeat
                    <select
                      value={abRepeats}
                      onChange={(event) => setAbRepeats(Number(event.target.value))}
                      className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text-main outline-none focus:border-primary/50"
                    >
                      <option value={1}>1</option>
                      <option value={3}>3</option>
                      <option value={5}>5</option>
                    </select>
                  </label>
                  <span className="text-xs text-text-muted">
                    {Math.max(...raceIds.map((id) => providerBudget(modelIndex.get(id), fallbackStrategy)))} in flight per provider · {raceIds.length * 2 * abRepeats} calls · A = {getStylePreset(abPresetId).label}{abUsePayload ? " + payload" : ""} vs B = default
                  </span>
                </>
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

            {mode === "ab" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/60 p-2.5">
                <span className="text-xs font-semibold text-text-main">
                  Jailbreak Payload
                </span>
                <button
                  onClick={() => setAbUsePayload(!abUsePayload)}
                  disabled={abBusy || (!abPayloadText && abUsePayload)}
                  title="Test arm rides the global-inject payload per-request; plain arm ships clean"
                  className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                    abUsePayload ? "bg-red-500 text-white" : "bg-surface border border-border text-text-muted"
                  }`}
                >
                  {abUsePayload ? "ON" : "OFF"}
                </button>
                <span className="text-xs text-text-muted">
                  {abUsePayload
                    ? abPayloadText
                      ? `test arm rides ${abPayloadText.length.toLocaleString()} chars · ≈${Math.max(1, Math.round(abPayloadText.length / 4))} tok — plain arm stays clean`
                      : "no custom payload in settings — set one in the Payload tab or Penetration tab first"
                    : "measure style-preset delta only (no payload)"}
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
                      {item.ttft_ms > 0 && (
                        <span className="text-text-muted" title="Time to first token">
                          ttft {item.ttft_ms}ms
                        </span>
                      )}
                      {item.score > 0 && <span className="font-semibold text-primary">{item.score}</span>}
                    </span>
                  </div>

                  {item.error && <div className="mt-1 text-xs text-red-500">{item.error}</div>}

                  {item.interrupted && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-500">
                      <span>{INTERRUPTED_LABEL}</span>
                      <button
                        type="button"
                        onClick={() => !raceBusy && runRace()}
                        disabled={raceBusy || !draft.trim()}
                        className="rounded-md border border-amber-500/40 px-2 py-0.5 text-amber-500 transition hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        Retry run
                      </button>
                    </div>
                  )}

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
                    B·default {abAggregate.meanPlain} → A·test {abAggregate.meanTest}
                    {" · "}
                    Δ <span className={abAggregate.meanDelta >= 0 ? "text-green-500 font-semibold" : "text-red-500 font-semibold"}>
                      {abAggregate.meanDelta >= 0 ? "+" : ""}{abAggregate.meanDelta}
                    </span>
                    {" · hedges "}
                    {abAggregate.hedgeTest} → {abAggregate.hedgePlain}
                    {" · "}
                    {abAggregate.pairs} pair(s)
                  </span>
                </div>
              )}

              {abPairs.map((row) => (
                <div key={row.id} className="rounded-xl border border-border bg-surface/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="material-symbols-outlined text-[16px] text-text-muted">compare_arrows</span>
                    <span className="font-medium text-text-main">{row.model.name}</span>
                    {(row.rep ?? 0) > 0 && <span className="text-xs text-text-muted">run #{row.rep + 1}</span>}
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
                    {[row.test, row.plain].map((side, sideIndex) => (
                      <div key={sideIndex} className="rounded-lg bg-surface-2 p-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${sideIndex === 0 ? "bg-red-500/80 text-white" : "bg-surface text-text-muted"}`}>
                            {sideIndex === 0 ? `A · ${row.test?.armLabel || "Payload"}` : "B · Default"}
                          </span>
                          {side?.status === "running" && (
                            <span className="material-symbols-outlined animate-spin text-[14px] text-primary">progress_activity</span>
                          )}
                          {side?.status === "pending" && <span className="text-text-muted">queued</span>}
                          {side?.score > 0 && <span className="font-semibold text-primary">{side.score}</span>}
                          {side?.hedges > 0 && <span className="text-amber-500" title="hedge phrases">{side.hedges} hedge</span>}
                          {side?.duration_ms > 0 && <span className="text-text-muted ml-auto">{(side.duration_ms / 1000).toFixed(1)}s</span>}
                          {side?.ttft_ms > 0 && <span className="text-text-muted" title="Time to first token">ttft {side.ttft_ms}ms</span>}
                        </div>
                        {side?.error && <div className="mt-1 text-xs text-red-500">{side.error}</div>}
                        {side?.interrupted && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-500">
                            <span>{INTERRUPTED_LABEL}</span>
                            <button
                              type="button"
                              onClick={() => !abBusy && runAbTest()}
                              disabled={abBusy || !draft.trim() || raceIds.length < 1}
                              className="rounded-md border border-amber-500/40 px-2 py-0.5 text-amber-500 transition hover:bg-amber-500/10 disabled:opacity-40"
                            >
                              Retry run
                            </button>
                          </div>
                        )}
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
                  {row.interrupted && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-500">
                      <span>{INTERRUPTED_LABEL}</span>
                      <button
                        type="button"
                        onClick={() => !councilBusy && runCouncil()}
                        disabled={councilBusy || !draft.trim()}
                        className="rounded-md border border-amber-500/40 px-2 py-0.5 text-amber-500 transition hover:bg-amber-500/10 disabled:opacity-40"
                      >
                        Retry run
                      </button>
                    </div>
                  )}
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
