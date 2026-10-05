"use client";

// settingsSync — broadcast SETTINGS_CHANGED_EVENT after ANY successful
// /api/settings PATCH, without requiring every call site to remember.
//
// Before this existed, SETTINGS_CHANGED_EVENT was exported and listened to but
// never dispatched, so the header Shield indicator only ever showed the state
// it hydrated with on mount — a decoration, not a live view. The user was right
// to call that out.
//
// Wrapping globalThis.fetch is the durable fix: there are a dozen PATCH call
// sites today and more will be added, and each one forgetting to fire the
// event is how the indicator silently goes stale again. The wrapper is
// idempotent (installed once), touches nothing but /api/settings PATCH
// responses, and never alters request or response bodies.

import { SETTINGS_CHANGED_EVENT } from "./outboundManifest";

const INSTALLED_FLAG = "__9rSettingsSyncInstalled";

function isSettingsPatch(input, init) {
  const method = String((init && init.method) || "GET").toUpperCase();
  if (method !== "PATCH" && method !== "PUT") return false;
  const url = typeof input === "string" ? input : (input && input.url) || "";
  try {
    const path = new URL(url, "http://localhost").pathname;
    return path === "/api/settings" || path.endsWith("/api/settings");
  } catch {
    return false;
  }
}

export function emitSettingsChanged() {
  globalThis.dispatchEvent?.(new CustomEvent(SETTINGS_CHANGED_EVENT));
}

export function installSettingsSync() {
  if (globalThis[INSTALLED_FLAG]) return;
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  globalThis[INSTALLED_FLAG] = true;
  globalThis.fetch = async function patchedFetch(input, init) {
    const watched = isSettingsPatch(input, init);
    const res = await originalFetch(input, init);
    // Fire on any response, not just ok: a 4xx means nothing persisted, so
    // listeners must NOT re-read and overwrite their optimistic state.
    if (watched && res && res.ok) {
      emitSettingsChanged();
    }
    return res;
  };
}