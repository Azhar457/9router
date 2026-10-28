"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/shared/components/Modal";

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

  // selection + edit + view state
  const [selected, setSelected] = useState({});
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [viewRow, setViewRow] = useState(null); // { id, text, chars }
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch(API);
      const d = await r.json();
      setRows(d.rows || []);
      setSelected({});
    } catch {
      setMsg("Failed to load payload list");
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

  // import from GitHub URL (repo URL or raw file URL) — explicit button click,
  // not Enter/blur, so the intent is unambiguous
  const runImport = async () => {
    const urlStr = importUrl.trim();
    if (!urlStr || importing) return;
    setImporting(true);
    setMsg("Importing " + urlStr + " …");
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlStr }),
      });
      const d = await r.json();
      if (d.error) setMsg("Import failed: " + d.error);
      else setMsg(`Imported ${d.saved} file(s).`);
      setImportUrl("");
    } catch (e) {
      setMsg("Import failed: " + e.message);
    }
    setImporting(false);
    refresh();
  };

  // upload local .md/.txt via drag-and-drop
  const onFile = async (f) => {
    if (!f) return;
    if (!/\.md|\.txt$/i.test(f.name)) {
      setMsg("Only .md or .txt files");
      return;
    }
    if (f.size > 512 * 1024) {
      setMsg("File too large (>512 KB)");
      return;
    }
    const text = await f.text();
    setMsg(`Saving ${f.name} …`);
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.name, text }),
    });
    const d = await r.json();
    setMsg(d.error || `Saved ${d.names?.[0] || f.name}.`);
    refresh();
  };

  const del = async (id) => {
    if (!confirm(`Delete ${id}?`)) return;
    const r = await fetch(API + "?id=" + encodeURIComponent(id), { method: "DELETE" });
    if (r.status === 404) setMsg(id + " not found");
    else setMsg(`Deleted ${id}.`);
    refresh();
  };

  // Batch delete — selected ids perish in one request.
  const deleteSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} payload(s)?`)) return;
    setMsg(`Deleting ${ids.length} payload(s) …`);
    try {
      const r = await fetch(API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      setMsg(
        d.deleted
          ? `Deleted ${d.deleted} payload(s)${d.missing?.length ? `, ${d.missing.length} not found` : ""}.`
          : (d.error || "Nothing deleted."),
      );
    } catch (e) {
      setMsg("Batch delete failed: " + e.message);
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
      setMsg("Failed to load payload text");
    }
  };

  // rename → the id IS the filename slug, so the row id changes after PATCH
  const startRename = (r) => { setEditId(r.id); setEditName(r.file); };
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
        setMsg(`Renamed ${oldId} → ${d.id}. Dropdown / Global Injection menunjuk id baru.`);
        if (selected[oldId]) setSelected((s) => ({ ...s, [d.id]: true }));
      }
    } catch (e) {
      setMsg("Rename failed: " + e.message);
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
      else setMsg(`${id} → ${cat}`);
    } catch (e) {
      setMsg("Category update failed: " + e.message);
    }
    refresh();
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
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runImport(); }}
              placeholder="github.com/you/repo or raw.githubusercontent.com/…/x.md"
              className="flex-1 min-w-0 px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-main focus:outline-none focus:border-primary"
            />
            <button
              onClick={runImport}
              disabled={!importUrl.trim() || importing}
              className="shrink-0 px-4 py-2 rounded bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? "…" : "Import"}
            </button>
          </div>
          <p className="text-text-muted text-[11px] mt-1.5">
            Repo URL imports all .md/.txt recursively (≤4 folder levels, ≤512 KB/file, ≤200 files; README/LICENSE skipped).
            A raw file URL imports just that one.
          </p>
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
                    aria-label={`Select ${r.id}`}
                  />
                </td>
                <td className="px-3 py-2 text-text-main font-mono text-[12px]">
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
                      <button onClick={submitRename} className="text-primary hover:text-primary/70 text-xs transition-colors">save</button>
                      <button onClick={() => setEditId(null)} className="text-text-muted hover:text-text-main text-xs transition-colors">cancel</button>
                    </span>
                  ) : r.id}
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
                  <button onClick={() => preview(r.id)} className="text-text-muted hover:text-primary text-xs transition-colors">view</button>
                  <button onClick={() => startRename(r)} className="text-text-muted hover:text-primary text-xs transition-colors">rename</button>
                  <button onClick={() => del(r.id)} className="text-danger hover:text-danger/70 text-xs transition-colors">delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows?.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-bg-base">
            <span className="text-text-muted text-[11px]">
              {selectedCount} selected
            </span>
            <button
              onClick={deleteSelected}
              disabled={!selectedCount}
              className="px-3 py-1.5 rounded border border-border text-xs font-semibold text-text-main hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Delete selected ({selectedCount})
            </button>
          </div>
        )}
      </div>

      {/* view modal — isi payload, read-only */}
      <Modal
        isOpen={!!viewRow}
        onClose={() => setViewRow(null)}
        title={viewRow ? viewRow.id : ""}
        size="xl"
        showTrafficLights={false}
        footer={
          viewRow && (
            <span className="text-xs text-text-muted">
              {viewRow.chars.toLocaleString()} chars — read-only
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
