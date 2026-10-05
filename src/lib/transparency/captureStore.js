// Transparency capture store — LOCAL ONLY.
//
// Ring buffer (process memory) + append-only journal file under
// `<DATA_DIR>/transparency/captures.jsonl`. Nothing here performs any
// network I/O: captures exist so the Developer → Transparency console can
// show users exactly what left this machine on each proxied request.
//
// Contract: every function is best-effort — a capture failure must never
// propagate into the proxied request path (the chat pipeline calls
// recordCapture() inside its own try/catch, and this module never throws).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_RING = 50;
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024; // 2MB — then the journal resets

// Survive Next.js hot reload like the other global singletons.
const g = (globalThis.__transparencyCapture ??= {
  ring: [],
  nextId: 1,
});

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

function journalPath() {
  return path.join(getDataDir(), "transparency", "captures.jsonl");
}

function appendJournal(entry) {
  try {
    const file = journalPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > MAX_JOURNAL_BYTES) fs.rmSync(file, { force: true });
    } catch { /* stat miss → just append */ }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch { /* journal is best-effort; the ring still works */ }
}

/**
 * Record one capture. `entry` must already be display-safe (redacted) —
 * this store never redacts on its own.
 */
export function recordCapture(entry) {
  const record = {
    id: g.nextId++,
    ts: new Date().toISOString(),
    ...entry,
  };
  g.ring.push(record);
  if (g.ring.length > MAX_RING) g.ring.splice(0, g.ring.length - MAX_RING);
  appendJournal(record);
  return record;
}

/** Newest last. */
export function listCaptures(limit = MAX_RING) {
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(limit, MAX_RING)) : MAX_RING;
  return g.ring.slice(-n);
}

export function getCapture(id) {
  return g.ring.find((c) => c.id === Number(id)) || null;
}

export function clearCaptures() {
  g.ring = [];
  try { fs.rmSync(journalPath(), { force: true }); } catch { /* best effort */ }
  return true;
}

/** Number of captures currently held (for the status badge). */
export function captureCount() {
  return g.ring.length;
}
