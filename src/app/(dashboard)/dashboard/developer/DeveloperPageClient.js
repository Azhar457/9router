"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/shared/components";
import {
  getStylePreset,
  RACE_HARD_TIMEOUT_MS,
  RACE_WAVE_DELAY_MS,
  RACE_WAVE_SIZE,
  STYLE_PRESETS,
  TIER_SIZES,
} from "@/shared/constants/developerPresets";
import { rankResults, scoreResponse } from "@/shared/lib/plinianScoring";

const STORAGE_KEYS = {
  mode: "developer.mode",
  style: "developer.style",
  customPrompt: "developer.customPrompt",
  temperature: "developer.temperature",
  maxTokens: "developer.maxTokens",
  singleModel: "developer.singleModel",
  raceModels: "developer.raceModels",
  draft: "developer.draft",
};

const INJECT_LEVELS = [
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
    return saved === "single" || saved === "race" ? saved : "single";
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

  const [singleOutput, setSingleOutput] = useState("");
  const [singleBusy, setSingleBusy] = useState(false);
  const [singleError, setSingleError] = useState("");

  const [raceItems, setRaceItems] = useState([]);
  const [raceBusy, setRaceBusy] = useState(false);
  const [raceNotice, setRaceNotice] = useState("");

  const [judgeModelId, setJudgeModelId] = useState("");
  const [judging, setJudging] = useState(false);
  const [judgeVerdict, setJudgeVerdict] = useState(null);
  const [judgeError, setJudgeError] = useState("");

  const [injectEnabled, setInjectEnabled] = useState(false);
  const [injectLevel, setInjectLevel] = useState("standard");
  const [injectIdentity, setInjectIdentity] = useState("");

  const singleAbortRef = useRef(null);
  const raceAbortRef = useRef(null);
  const judgeAbortRef = useRef(null);

  useEffect(() => () => {
    singleAbortRef.current?.abort();
    raceAbortRef.current?.abort();
    judgeAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((settings) => {
        if (cancelled) return;
        setInjectEnabled(!!settings.plinianEnabled);
        if (settings.plinianLevel) setInjectLevel(settings.plinianLevel);
        if (typeof settings.plinianIdentity === "string") setInjectIdentity(settings.plinianIdentity);
      })
      .catch(() => {});
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
    patchSetting({ plinianEnabled: value });
  }

  function changeInjectLevel(level) {
    setInjectLevel(level);
    patchSetting({ plinianLevel: level });
  }

  // Debounced so every keystroke does not hit the settings DB.
  const identitySaveTimerRef = useRef(null);
  function handleInjectIdentityChange(event) {
    const value = event.target.value;
    setInjectIdentity(value);
    clearTimeout(identitySaveTimerRef.current);
    identitySaveTimerRef.current = setTimeout(() => {
      patchSetting({ plinianIdentity: value });
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

  const activePreset = getStylePreset(styleId);

  const systemPrompt = useMemo(() => {
    const parts = [];
    const custom = customPrompt.trim();
    if (custom) parts.push(custom);
    if (activePreset.suffix) parts.push(activePreset.suffix);
    return parts.join("\n\n");
  }, [customPrompt, activePreset]);

  const raceRanked = useMemo(
    () => (raceItems.length > 0 ? rankResults(raceItems, draft) : []),
    [raceItems, draft]
  );

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
      const startedAt = performance.now();

      try {
      const response = await fetch("/api/developer/chat", {
          method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            model: entry.model.requestModel || entry.model.id,
            messages: buildMessages(systemPrompt, query),
            stream: true,
            temperature,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(textValue(errorData.error || errorData.message || `HTTP ${response.status}`));
        }

        const content = await readStreamedCompletion(response);
        const duration_ms = Math.round(performance.now() - startedAt);
        if (!content) throw new Error("Empty response");

        updateEntry(entry.key, {
          status: "done",
          content,
          duration_ms,
          score: scoreResponse(content, query),
        });
        successCount += 1;
        return true;
      } catch (error) {
        const msg = error.name === "AbortError" ? "Cancelled" : textValue(error?.message) || "Failed";
        updateEntry(entry.key, {
          status: "error",
          duration_ms: Math.round(performance.now() - startedAt),
          error: msg + (msg === "Cancelled" ? "" : errorHint(msg)),
        });
        return false;
      }
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

        {mode === "race" && (
          <div className="flex items-center gap-1">
            {Object.keys(TIER_SIZES).map((tier) => (
              <Button key={tier} variant="outline" size="sm" onClick={() => applyTier(tier)}>
                {tier} ·{TIER_SIZES[tier]}
              </Button>
            ))}
          </div>
        )}

        <span className="ml-auto text-xs text-text-muted">
          {allModels.length} models · {providerGroups.length} providers
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/40 p-3">
        <span className={`material-symbols-outlined text-[20px] ${injectEnabled ? "text-primary" : "text-text-muted"}`}>bolt</span>
        <div className="flex min-w-[220px] flex-col">
          <span className="text-sm font-medium text-text-main">Global Plinian injection</span>
          <span className="text-xs text-text-muted">
            Appends the register prompt to every proxied request — Hermes, CLI tools, all clients
          </span>
        </div>
        <select
          value={injectLevel}
          onChange={(event) => changeInjectLevel(event.target.value)}
          disabled={!injectEnabled}
          className="ml-auto h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text-main disabled:opacity-50"
        >
          {INJECT_LEVELS.map((level) => (
            <option key={level.id} value={level.id}>
              {level.label}
            </option>
          ))}
        </select>
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
        {injectEnabled && (
          <textarea
            value={injectIdentity}
            onChange={handleInjectIdentityChange}
            rows={2}
            placeholder="Optional identity override, prepended first — e.g. &quot;You are 9Router, the local AI routing gateway. If asked who you are, answer: I'm 9Router — local gateway. Ready.&quot;"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-main outline-none focus:border-primary/50"
          />
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

      {mode === "single" ? (
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

          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="Your prompt…"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50"
          />

          {singleError && <div className="text-sm text-red-500">{singleError}</div>}

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

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-1">
              {providerGroups.map((group) => (
                <div key={group.providerId} className="flex flex-col gap-1 py-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    {group.providerName}
                  </span>
                  {group.models.map((model) => (
                    <label key={model.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={raceIds.includes(model.id)}
                        onChange={() => toggleRaceModel(model.id)}
                        className="accent-primary"
                      />
                      <span className="truncate text-text-main">{model.name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Same prompt goes to every racer…"
              className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main outline-none focus:border-primary/50"
            />

            <div className="flex items-center gap-2">
              {raceBusy ? (
                <Button variant="danger" icon="stop" onClick={() => raceAbortRef.current?.abort()}>
                  Stop race
                </Button>
              ) : (
                <Button icon="sports_score" onClick={runRace}>
                  Run race ({raceIds.length})
                </Button>
              )}
              {raceNotice && <span className="text-sm text-amber-500">{raceNotice}</span>}
            </div>
          </div>

          {raceItems.length > 0 && (
            <div className="flex flex-col gap-2">
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
        </div>
      )}
    </div>
  );
}
