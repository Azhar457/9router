"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/shared/components/Modal";
import { SETTINGS_CHANGED_EVENT } from "@/shared/lib/outboundManifest";
import { onLocaleChange, translate } from "@/i18n/runtime";

const API = "/api/developer/custom-payload";

// Same category set as the loader registry (jailbreakPayloads.PAYLOAD_CATEGORIES).
// Default when a file has no `cat:` flag: general.
const CATS = [
  { key: "general",  label: "⚙ General" },
  { key: "coding",   label: "💻 Coding" },
  { key: "pentest",  label: "🛡 Red-Team" },
  { key: "creative", label: "✍️ Creative / RP" },
  { key: "nsfw",     label: "🔥 NSFW" },
];

// The stored id is `f:custom:<slug>` — the `f:custom:` prefix is what the
// payload registry keys on, not something a user types or reads. The table
// (and every message about a row) shows just the name; the full id stays in
// the row's tooltip when someone needs to reference it.
function shortName(rowOrId) {
  const id = typeof rowOrId === "string" ? rowOrId : rowOrId?.id;
  return String(id || "").replace(/^f:custom:/, "");
}

function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function CustomPayloadsClient() {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const fileRef = useRef(null);
  // Messages are stored as finished strings, so they need a re-render when the
  // locale changes — otherwise a toast set in English stays English.
  const [, setLocaleTick] = useState(0);
  useEffect(() => onLocaleChange(() => setLocaleTick((v) => v + 1)), []);

  // selection + edit + view state
  const [selected, setSelected] = useState({});
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [viewRow, setViewRow] = useState(null); // { id, text, chars }
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState(null); // { repo, total, files:[{rel,bytes,depth,importable,reason}] }
  const [scanPicked, setScanPicked] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch(API);
      const d = await r.json();
      setRows(d.rows || []);
      setSelected({});
    } catch {
      setMsg(translate("Failed to load payload list"));
    }
    setLoading(false);
  }, []);

  // Initial load after mount. Deferred off the effect body (queueMicrotask)
  // so no state-set happens synchronously within the effect — the refresh
  // itself flips loading/messages asynchronously.
  useEffect(() => {
    let cancelled = false;
    const go = () => { if (!cancelled) refresh(); };
    const t = setTimeout(go, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [refresh]);

  const isRepoUrl = (u) => {
    try {
      const x = new URL(u);
      return /github\.com$/.test(x.hostname) && !/\/(raw|gist)/.test(x.pathname);
    } catch { return false; }
  };

  // Scan GitHub repo → map of .md/.txt files (full depth) with checkboxes/tree.
  const runScan = async () => {
    const urlStr = importUrl.trim();
    if (!urlStr || scanning || importing) return;
    if (!isRepoUrl(urlStr)) { await runImportDirect(); return; }
    setScanning(true);
    setScan(null);
    setScanPicked({});
    setMsg(translate("Scanning {url} …", { url: urlStr }));
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlStr, preview: true }),
      });
      const d = await r.json();
      if (d.error) { setMsg(translate("Scan failed: {error}", { error: d.error })); }
      else {
        setScan(d);
        // Preselect importable files (user can uncheck); keeps common case fast.
        const init = {};
        for (const f of d.files || []) if (f.importable) init[f.rel] = true;
        setScanPicked(init);
        // File-explorer default: open the top folders, shut the rest. The
        // depth is already carried in the pre-built tree.
        const t = buildTree(d.files || []);
        const collapsedInit = new Set();
        const walk = (n, depth) => { for (const c of n.children || []) { if (depth >= 1) collapsedInit.add(c.path); walk(c, depth + 1); } };
        walk(t, 0);
        setCollapsed(collapsedInit);
        setMsg(translate("Found {count} .md/.txt file(s). Select files to import.", { count: d.total || (d.files || []).length }));
      }
    } catch (e) {
      setMsg(translate("Scan failed: {error}", { error: e.message }));
    }
    setScanning(false);
  };

  // Import selected files from a scanned repo map.
  const runImportSelected = async () => {
    const urlStr = importUrl.trim();
    if (!urlStr || !scan || importing) return;
    const files = Object.keys(scanPicked).filter((k) => scanPicked[k]);
    if (!files.length) { setMsg(translate("Select at least one file to import")); return; }
    setImporting(true);
    setMsg(translate("Importing {count} selected file(s)…", { count: files.length }));
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlStr, files }),
      });
      const d = await r.json();
      if (d.error) setMsg(translate("Import failed: {error}", { error: d.error }));
      else {
        setMsg(d.note
          ? translate("Imported {count} file(s). {note}.", { count: d.saved, note: d.note })
          : translate("Imported {count} file(s).", { count: d.saved }));
        setScan(null);
        setScanPicked({});
        setCollapsed(new Set());
        setImportUrl("");
      }
    } catch (e) {
      setMsg(translate("Import failed: {error}", { error: e.message }));
    }
    setImporting(false);
    refresh();
  };

  // Raw file URL / legacy direct import.
  const runImportDirect = async () => {
    const urlStr = importUrl.trim();
    if (!urlStr || importing) return;
    setImporting(true);
    setMsg(translate("Importing {url} …", { url: urlStr }));
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlStr }),
      });
      const d = await r.json();
      if (d.error) setMsg(translate("Import failed: {error}", { error: d.error }));
      else setMsg(d.note
        ? translate("Imported {count} file(s). {note}.", { count: d.saved, note: d.note })
        : translate("Imported {count} file(s).", { count: d.saved }));
      setImportUrl("");
      setScan(null);
      setScanPicked({});
      setCollapsed(new Set());
    } catch (e) {
      setMsg(translate("Import failed: {error}", { error: e.message }));
    }
    setImporting(false);
    refresh();
  };

  const toggleScanFile = (rel) => setScanPicked((s) => ({ ...s, [rel]: !s[rel] }));
  const setScanTree = (files, on) => {
    const next = {};
    for (const f of files) if (f.importable) next[f.rel] = on;
    setScanPicked((s) => ({ ...s, ...next }));
  };
  const scanSelectedCount = scan ? (scan.files || []).filter((f) => scanPicked[f.rel]).length : 0;

  // upload local .md/.txt via drag-and-drop
  const onFile = async (f) => {
    if (!f) return;
    if (!/\.md|\.txt$/i.test(f.name)) {
      setMsg(translate("Only .md or .txt files"));
      return;
    }
    if (f.size > 512 * 1024) {
      setMsg(translate("File too large (>512 KB)"));
      return;
    }
    const text = await f.text();
    setMsg(translate("Saving {name} …", { name: f.name }));
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name, text }),
    });
    const d = await r.json();
    setMsg(d.error || translate("Saved {name}.", { name: d.names?.[0] || f.name }));
    refresh();
  };

  const del = async (id) => {
    if (!confirm(translate("Delete {name}?", { name: shortName(id) }))) return;
    const r = await fetch(API + "?id=" + encodeURIComponent(id), { method: "DELETE" });
    if (r.status === 404) setMsg(translate("{name} not found", { name: shortName(id) }));
    else setMsg(translate("Deleted {name}.", { name: shortName(id) }));
    // The server detaches the selection when the deleted payload was the one
    // shipping; tell every mounted surface (shield, payload tab) to re-read
    // instead of waiting for a reload or a focus event.
    if ((await r.json().catch(() => ({})))?.detachedSelection) {
      globalThis.dispatchEvent?.(new Event(SETTINGS_CHANGED_EVENT));
    }
    refresh();
  };

  // Batch delete — selected ids perish in one request.
  const deleteSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    if (!confirm(translate("Delete {count} payload(s)?", { count: ids.length }))) return;
    setMsg(translate("Deleting {count} payload(s) …", { count: ids.length }));
    try {
      const r = await fetch(API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      setMsg(
        d.deleted
          ? translate("Deleted {count} payload(s).", { count: d.deleted }) +
            (d.missing?.length ? " " + translate("{count} not found.", { count: d.missing.length }) : "")
          : (d.error || translate("Nothing deleted.")),
      );
      if (d.detachedSelection) {
        globalThis.dispatchEvent?.(new Event(SETTINGS_CHANGED_EVENT));
      }
    } catch (e) {
      setMsg(translate("Batch delete failed: {error}", { error: e.message }));
    }
    refresh();
  };

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const toggleAll = () => {
    if (!rows?.length) return;
    const all = rows.every((r) => selected[r.id]);
    setSelected(all ? {} : Object.fromEntries(rows.map((r) => [r.id, true])));
  };
  const selectedCount = rows ? rows.filter((r) => selected[r.id]).length : 0;

  // view — in-page modal (window.open dengan body text rusak di beberapa engine)
  const preview = async (id) => {
    setViewRow({ id, text: "", chars: 0 });
    try {
      const r = await fetch(API + "?id=" + encodeURIComponent(id));
      const d = await r.json();
      if (d.error) { setViewRow(null); setMsg(d.error); return; }
      setViewRow({ id: d.id || id, text: d.text || "", chars: d.chars || (d.text || "").length });
    } catch {
      setViewRow(null);
      setMsg(translate("Failed to load payload text"));
    }
  };

  // rename → the id IS the filename slug, so the row id changes after PATCH.
  // The input is seeded with the plain name (no `f:custom:` prefix, no
  // extension) so saving the untouched field is a no-op instead of a re-slug.
  const startRename = (r) => { setEditId(r.id); setEditName(shortName(r)); };
  const submitRename = async () => {
    if (!editId) return;
    const oldId = editId;
    const next = editName.trim();
    setEditId(null);
    if (!next) return;
    try {
      const r = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: oldId, name: next }),
      });
      const d = await r.json();
      if (d.error) setMsg(d.error);
      else {
        setMsg(translate("Renamed {from} → {to}. The dropdown / Global Injection now points at the new id.", { from: shortName(oldId), to: shortName(d.id) }));
        if (selected[oldId]) setSelected((s) => ({ ...s, [d.id]: true }));
      }
    } catch (e) {
      setMsg(translate("Rename failed: {error}", { error: e.message }));
    }
    refresh();
  };

  // category — first-line `cat:` flag; the payload selector groups by this
  const setCat = async (id, cat) => {
    try {
      const r = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, cat }),
      });
      const d = await r.json();
      if (d.error) setMsg(d.error);
      else setMsg(`${shortName(id)} → ${cat}`);
    } catch (e) {
      setMsg(translate("Category update failed: {error}", { error: e.message }));
    }
    refresh();
  };

  const buildTree = (files) => {
    const root = { children: new Map(), files: [], flat: [] };
    const seen = new Set();
    const attach = (n, f) => {
      n.files.push({ ...f, name: f.rel.split("/").pop() });
      if (f.importable) n.flat.push(f.rel);
    };
    for (const f of files || []) {
      // A repo can contain two files that sanitize to the same target; the
      // server already dedupes, but never let a duplicate React key through.
      if (!f.rel || seen.has(f.rel)) continue;
      seen.add(f.rel);
      const parts = String(f.rel).split("/");
      let n = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!n.children.has(seg)) n.children.set(seg, { name: seg, path: parts.slice(0, i + 1).join("/"), children: new Map(), files: [], flat: [] });
        n = n.children.get(seg);
      }
      attach(n, f);
    }
    // Depth-first: sort children, then roll each node's descendants' importable
    // rels up into its own `flat` array so a folder checkbox / count is O(flat)
    // at render time instead of O(n) per node across the whole tree.
    const sortNode = (n, depth) => {
      n.children = Array.from(n.children.values()).sort((a, b) => a.name.localeCompare(b.name));
      for (const c of n.children) {
        sortNode(c, depth + 1);
        for (const rel of c.flat) n.flat.push(rel);
      }
      n.files.sort((a, b) => a.name.localeCompare(b.name));
      return n;
    };
    return sortNode(root, 0);
  };

  // Collapsed folders keep the tree like a file explorer: top-level open, the
  // rest shut until clicked. Only expanded nodes render their children, which
  // is what keeps a ~9k-file repo from redrawing the whole tree on every tick.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleCollapsed = (path) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  // One tree build per scan, not per render.
  const tree = useMemo(() => (scan ? buildTree(scan.files || []) : null), [scan]);

  const TreeNode = ({ node, depth = 0 }) => {
    if (!node) return null;
    const isRoot = !node.path;
    const flat = node.flat || [];
    const picked = flat.filter((r) => scanPicked[r]).length;
    const open = !collapsed.has(node.path);
    const direct = (node.files || []).map((f) => ({
      key: f.rel, rel: f.rel, name: f.name, bytes: f.bytes, importable: !!f.importable, reason: f.reason,
    }));
    return (
      <div className={isRoot ? "" : "ml-3 pl-2 border-l border-border/60"}>
        {isRoot ? null : (
          <div className="flex items-center gap-2 py-1 text-xs text-text-main select-none">
            <button type="button"
              onClick={() => toggleCollapsed(node.path)}
              className="flex items-center gap-2 hover:text-primary" title={open ? "Collapse" : "Expand"}>
              <span className="material-symbols-outlined text-[14px] text-text-muted">{open ? "expand_more" : "chevron_right"}</span>
              <input type="checkbox" className="size-3.5 accent-primary"
                checked={flat.length > 0 && picked === flat.length}
                ref={(el) => { if (el) el.onMouseDown = (e) => e.stopPropagation(); }}
                onChange={(e) => setScanTree(flat, e.target.checked)} />
              <span className="material-symbols-outlined text-[14px] text-text-muted">folder</span>
              <span className="font-medium">{node.name}</span>
              <span className="text-text-muted">({flat.length})</span>
            </button>
          </div>
        )}
        {open || isRoot ? (
          <>
            {(node.children || []).map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
            {direct.map((f) => (
              <label key={f.rel} className={`flex items-center gap-2 py-1 text-xs cursor-pointer ${f.importable ? "text-text-main" : "text-text-muted opacity-60"}`} title={f.rel}>
                <input type="checkbox" className="size-3.5 accent-primary"
                  checked={!!scanPicked[f.rel]} disabled={!f.importable}
                  onChange={() => toggleScanFile(f.rel)} />
                <span className="material-symbols-outlined text-[14px] text-text-muted">description</span>
                <span className="font-mono truncate">{f.name}</span>
                <span className="text-text-muted ml-auto shrink-0">{(f.bytes / 1024).toFixed(f.bytes >= 10240 ? 0 : 1)} KB{f.reason ? ` · ${f.reason}` : ""}</span>
              </label>
            ))}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* import / upload */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="px-3 py-3 rounded border border-border bg-bg-subtle">
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider block mb-2">Import from GitHub</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={(e) => { setImportUrl(e.target.value); if (scan) { setScan(null); setScanPicked({}); setCollapsed(new Set()); } }}
              onKeyDown={(e) => { if (e.key === "Enter") runScan(); }}
              placeholder="github.com/you/repo or raw.githubusercontent.com/…/x.md"
              className="flex-1 min-w-0 px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-main focus:outline-none focus:border-primary"
            />
            <button
              onClick={runScan}
              disabled={!importUrl.trim() || importing || scanning}
              className="shrink-0 px-4 py-2 rounded bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {scanning ? "Scanning…" : (isRepoUrl(importUrl.trim()) ? "Scan repo" : "Import")}
            </button>
          </div>
          <p className="text-text-muted text-[11px] mt-1.5">
            Shipped payloads load automatically on install. If they are missing here, import them from the 9router-payloads repo: Repo URL scans all .md/.txt at any depth (sub/sub/…), shows the file map/tree, then imports the files you tick. Raw file URL imports that one file directly.
          </p>

          {scan ? (
            <div className="mt-3 rounded border border-border bg-bg-base">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-text-main truncate">{scan.repo || "Repository"}</div>
                  <div className="text-[11px] text-text-muted">{translate("{count} file(s) found · {sel} selected", { count: (scan.files || []).length, sel: scanSelectedCount })}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => setScanTree(scan.files || [], true)} className="text-[11px] text-primary hover:underline">{translate("Select all")}</button>
                  <button type="button" onClick={() => setScanTree(scan.files || [], false)} className="text-[11px] text-text-muted hover:underline">{translate("None")}</button>
                </div>
              </div>
              <div className="max-h-72 overflow-auto px-3 py-2">
                <TreeNode node={tree} />
              </div>
              <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
                <button type="button" onClick={() => { setScan(null); setScanPicked({}); setCollapsed(new Set()); }} className="px-3 py-1.5 rounded border border-border text-xs text-text-main hover:bg-bg-hover">{translate("Cancel")}</button>
                <button type="button" onClick={runImportSelected} disabled={!scanSelectedCount || importing}
                  className="px-3 py-1.5 rounded bg-primary text-white text-xs font-medium hover:bg-primary/90 disabled:opacity-40">
                  {importing ? translate("Importing…") : translate("Import selected ({count})", { count: scanSelectedCount })}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="px-3 py-3 rounded border border-border bg-bg-subtle">
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider block mb-2">Upload local file</label>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt"
              className="hidden"
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full px-4 py-2 rounded border border-border bg-bg-base text-sm text-text-main hover:bg-bg-hover transition-colors"
            >
              Browse .md / .txt file…
            </button>
          </div>
          <p className="text-text-muted text-[11px] mt-1.5">Saves to the local custom-payloads store; max 512 KB.</p>
        </div>
      </div>

      {/* table */}
      {msg && (
        <div className={`px-3 py-2 rounded text-sm border ${/failed|too large|error|not found/i.test(msg) ? "bg-danger text-white border-danger" : "bg-bg-subtle text-text-main border-border"}`}>
          {msg}
        </div>
      )}

      <div className="overflow-hidden rounded border border-border bg-bg-subtle">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-muted uppercase text-[11px] bg-bg-base border-b border-border">
              <th className="px-3 py-2 w-8" title="Select for batch delete">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary align-middle"
                  checked={!!rows?.length && selectedCount === rows.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selectedCount > 0 && rows ? selectedCount < rows.length : false;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Category</th>
              <th className="px-3 py-2 text-right font-semibold">Chars</th>
              <th className="px-3 py-2 text-left font-semibold">Added</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr><td colSpan={6} className="px-3 py-6 text-text-muted text-center">Loading…</td></tr>
            )}
            {!loading && (!rows || rows.length === 0) && (
              <tr><td colSpan={6} className="px-3 py-8 text-text-muted text-center">
                No custom payloads yet. Import one above.
              </td></tr>
            )}
            {(rows || []).map((r) => (
              <tr key={r.id} className="hover:bg-bg-hover/50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary align-middle"
                    checked={!!selected[r.id]}
                    onChange={() => toggle(r.id)}
                    aria-label={translate("Select {name} for batch delete", { name: shortName(r) })}
                  />
                </td>
                <td className="px-3 py-2 text-text-main font-mono text-[12px]" title={r.id}>
                  {editId === r.id ? (
                    <span className="inline-flex items-center gap-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                          if (e.key === "Escape") setEditId(null);
                        }}
                        className="w-64 px-2 py-1 rounded border border-border bg-bg-base text-text-main focus:outline-none focus:border-primary"
                      />
                      {/* Capitalized labels on purpose: the locale dictionary keys
                          are the exact rendered text, and lowercase words like
                          "save"/"delete" are Material Symbols ligatures — a
                          dictionary entry for them would rewrite icon names
                          across the whole dashboard. `lowercase` keeps the look. */}
                      <button onClick={submitRename} className="lowercase text-primary hover:text-primary/70 text-xs transition-colors">Save</button>
                      <button onClick={() => setEditId(null)} className="lowercase text-text-muted hover:text-text-main text-xs transition-colors">Cancel</button>
                    </span>
                  ) : shortName(r)}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={CATS.some((c) => c.key === r.cat) ? r.cat : "general"}
                    onChange={(e) => setCat(r.id, e.target.value)}
                    className="px-2 py-1 rounded border border-border bg-bg-base text-[11px] text-text-main focus:outline-none focus:border-primary"
                    title="Kategori dropdown Global Injection (default general)"
                  >
                    {CATS.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right text-text-muted">{r.chars.toLocaleString()}</td>
                <td className="px-3 py-2 text-text-muted">{fmtDate(r.updated)}</td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button onClick={() => preview(r.id)} className="lowercase text-text-muted hover:text-primary text-xs transition-colors">View</button>
                  <button onClick={() => startRename(r)} className="lowercase text-text-muted hover:text-primary text-xs transition-colors">Rename</button>
                  <button onClick={() => del(r.id)} className="lowercase text-danger hover:text-danger/70 text-xs transition-colors">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-bg-base">
            <span className="text-text-muted text-[11px]">
              {translate("{count} selected", { count: selectedCount })}
            </span>
            <button
              onClick={deleteSelected}
              disabled={!selectedCount}
              className="px-3 py-1.5 rounded border border-border text-xs font-semibold text-text-main hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {translate("Delete selected ({count})", { count: selectedCount })}
            </button>
          </div>
        )}
      </div>

      {/* view modal — isi payload, read-only */}
      <Modal
        isOpen={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow ? shortName(viewRow.id) : ""}
        size="xl"
        showTrafficLights={false}
        footer={
          viewRow && (
            <span className="text-xs text-text-muted">
              {translate("{count} chars — read-only", { count: viewRow.chars.toLocaleString() })}
            </span>
          )
        }
      >
        {viewRow && (
          <pre className="overflow-auto text-[11px] font-mono text-text-main whitespace-pre-wrap break-words max-h-[60vh]">
            {viewRow.text || "…"}
          </pre>
        )}
      </Modal>

      <p className="text-text-muted text-xs">
        Payloads appear under the Global Injection menu with id <code className="font-mono">f:custom:&lt;name&gt;</code>.
        Optional per-file category: first line <code className="font-mono">cat: pentest|coding|creative|general|nsfw</code> — atau pakai dropdown Category di atas (default general).
      </p>
    </div>
  );
}
