// Outbound manifest — every feature that can send data beyond the core
// proxying lane, evaluated against live settings.
//
// Used by:
//   • the Developer → Transparency console ("What leaves this machine")
//   • the dashboard header badge (Outbound: core-only vs extras active)
//
// The console toggles each item by PATCHing /api/settings; `write` tells this
// module how a single feature is expressed as a settings value.
//
// kind:
//   provider → rides inside requests to the AI provider the user calls
//   network  → app-initiated fetch to a third party (no conversation data)
//   expose   → makes this instance reachable from outside the machine
//
// Every entry here must map to a settings key that the code actually
// consults at runtime (verified against src/sse/handlers/chat.js,
// shared/services/quotaAutoPing.js, modelCatalog/sync.js, tunnel routes).

export const OUTBOUND_FEATURES = [
  {
    key: "injectionEnabled",
    label: "Global Injection — register + jailbreak payload ke provider",
    category: "Payload steering",
    kind: "provider",
  },
  {
    key: "injectionCarrierEnabled",
    label: "Carrier wrap (payload dibungkus carrier frame)",
    category: "Payload steering",
    kind: "provider",
    requires: "injectionEnabled",
  },
  {
    key: "rtkEnabled",
    label: "RTK token saver — kompresi tool_result in-place",
    category: "Token savers",
    kind: "provider",
  },
  {
    key: "headroomEnabled",
    label: "Headroom — POST messages ke proxy compress eksternal",
    category: "Token savers",
    kind: "provider",
  },
  {
    key: "cavemanEnabled",
    label: "Caveman — inject system prompt gaya teks",
    category: "Token savers",
    kind: "provider",
  },
  {
    key: "ponytailEnabled",
    label: "Ponytail — inject system prompt gaya teks",
    category: "Token savers",
    kind: "provider",
  },
  {
    key: "pxpipeEnabled",
    label: "Pxpipe — kompresi gambar in-process",
    category: "Token savers",
    kind: "provider",
  },
  {
    key: "claudeAutoPing",
    label: "Claude quota auto-ping — request kecil otomatis ke provider",
    category: "Background traffic",
    kind: "provider",
  },
  {
    key: "codexAutoPing",
    label: "Codex quota auto-ping — request kecil otomatis ke provider",
    category: "Background traffic",
    kind: "provider",
  },
  {
    key: "catalogSyncEnabled",
    label: "Model catalog sync — GET harian ke models.dev",
    category: "Background traffic",
    kind: "network",
  },
  {
    key: "cloudEnabled",
    label: "Cloud URL (9router.com) dipakai sebagai base URL CLI tools",
    category: "Background traffic",
    kind: "network",
  },
  {
    key: "tunnelEnabled",
    label: "Cloudflare tunnel — ekspos gateway ke publik",
    category: "Exposure",
    kind: "expose",
  },
  {
    key: "tailscaleEnabled",
    label: "Tailscale funnel — ekspos gateway ke publik",
    category: "Exposure",
    kind: "expose",
  },
];

/**
 * Evaluate the feature list against settings.
 * Returns [{ key, label, category, kind, on }] — `requires` chains (carrier
 * only counts when injection itself is on) and per-connection maps
 * (auto-ping) count as ON only when at least one connection is enabled.
 */
function featureOn(f, s) {
  const value = s[f.key];
  if (f.key === "claudeAutoPing" || f.key === "codexAutoPing") {
    return !!value?.connections && Object.values(value.connections).some(Boolean);
  }
  return !!value && (!f.requires || !!s[f.requires]);
}

export function describeOutbound(settings) {
  const s = settings || {};
  return OUTBOUND_FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    category: f.category,
    kind: f.kind,
    on: featureOn(f, s),
  }));
}

export function countActiveOutbound(settings) {
  return describeOutbound(settings).filter((f) => f.on).length;
}

// Fired after a console toggle writes settings, so other views that mirror
// these keys (Developer injection card, header badge) can re-read them.
export const SETTINGS_CHANGED_EVENT = "9r:settings-changed";

// Per-connection auto-ping is a { connections: { id: true } } map: the console
// can clear it (OFF), but turning it ON needs a concrete connection id, so it
// stays opt-in from the Quota Tracker page.
const AUTO_PING_KEYS = ["claudeAutoPing", "codexAutoPing"];

export function canToggleOn(featureKey) {
  return !AUTO_PING_KEYS.includes(featureKey);
}

/**
 * Build the /api/settings patch for flipping one manifest feature.
 *
 * - Turning a dependent feature ON also switches its parent ON (carrier wrap
 *   without Global Injection is a no-op).
 * - Turning a parent OFF switches the dependents OFF in the same write, so the
 *   UI can never show "carrier ON, injection OFF".
 * Returns { patch, extras } — extras are keys that changed as a side effect.
 */
export function buildTogglePatch(featureKey, nextOn, settings = {}) {
  const feature = OUTBOUND_FEATURES.find((f) => f.key === featureKey);
  if (!feature) return { error: `Unknown outbound feature: ${featureKey}` };
  if (nextOn && !canToggleOn(featureKey)) {
    return {
      error:
        "Auto-ping is per-koneksi — nyalakan per connection di halaman Quota Tracker.",
    };
  }

  const patch = {};
  const extras = [];

  if (AUTO_PING_KEYS.includes(featureKey)) {
    patch[featureKey] = { connections: {} };
  } else {
    patch[featureKey] = !!nextOn;
  }

  // Dependent ON ⇒ parent ON.
  if (nextOn && feature.requires && !settings[feature.requires]) {
    patch[feature.requires] = true;
    extras.push(feature.requires);
  }
  // Parent OFF ⇒ dependents OFF.
  if (!nextOn) {
    for (const dep of OUTBOUND_FEATURES.filter((f) => f.requires === featureKey)) {
      if (settings[dep.key]) {
        patch[dep.key] = false;
        extras.push(dep.key);
      }
    }
  }

  return { patch, extras };
}
