"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api/developer/custom-payload";

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch(API);
      const d = await r.json();
      setRows(d.rows || []);
    } catch {
      setMsg("Failed to load payload list");
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // import from GitHub URL (repo URL or raw file URL)
  const importUrl = async (urlStr) => {
    if (!urlStr.trim()) return;
    setMsg("Importing from " + urlStr + " …");
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlStr.trim() }),
      });
      const d = await r.json();
      if (d.error) setMsg("Import failed: " + d.error);
      else setMsg(`Imported ${d.saved} file(s).`);
    } catch (e) {
      setMsg("Import failed: " + e.message);
    }
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

  const preview = async (id) => {
    const r = await fetch(API + "?id=" + encodeURIComponent(id));
    const d = await r.json();
    if (d.error) return setMsg(d.error);
    // read-only modal via native
    window.open(d.text, "_blank", "width=800,height=520");
  };

  return (
    <div className="space-y-6">
      {/* import / upload */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider block mb-1">Import from GitHub</label>
          <input
            type="url"
            placeholder="https://github.com/you/payloads or https://raw.githubusercontent.com/you/payloads/main/x.md"
            className="w-full px-3 py-2 bg-bg-subtle border border-border rounded text-sm text-text-main focus:outline-none focus:border-primary"
            onKeyDown={(e) => { if (e.key === "Enter") importUrl(e.target.value); e.target.value = ""; }}
            onBlur={(e) => { if (e.target.value.trim()) importUrl(e.target.value); }}
          />
          <p className="text-text-muted text-[11px] mt-1">
            Whole-repo URL imports all .md/.txt at the root+1 level (≤512 KB/file, ≤200 files; README/LICENSE skipped).
            Or paste a raw file URL to import just that one.
          </p>
        </div>
        <div>
          <label className="text-text-muted text-xs font-semibold uppercase tracking-wider block mb-1 cursor-pointer">
            Upload local file
            <input
              ref={fileRef}
              type="file"
              accept=".md,.txt"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-4 py-2 bg-bg-subtle border border-border rounded text-sm text-text-main hover:bg-bg-hover transition-colors"
          >
            Browse file…
          </button>
        </div>
      </div>

      {/* table */}
      {msg && (
        <div className={`px-3 py-2 rounded text-sm border ${/failed|too large|error/i.test(msg) ? "bg-danger text-white border-danger" : "bg-bg-subtle text-text-main border-border"}`}>
          {msg}
        </div>
      )}

      <div className="overflow-hidden rounded border border-border bg-bg-subtle">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-muted uppercase text-[11px] bg-bg-base border-b border-border">
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-right font-semibold">Chars</th>
              <th className="px-3 py-2 text-left font-semibold">Added</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr><td colSpan={4} className="px-3 py-6 text-text-muted text-center">Loading…</td></tr>
            )}
            {!loading && (!rows || rows.length === 0) && (
              <tr><td colSpan={4} className="px-3 py-8 text-text-muted text-center">
                No custom payloads yet. Import one above.
              </td></tr>
            )}
            {(rows || []).map((r) => (
              <tr key={r.id} className="hover:bg-bg-hover/50">
                <td className="px-3 py-2 text-text-main font-mono text-[12px]">{r.id}</td>
                <td className="px-3 py-2 text-right text-text-muted">{r.chars.toLocaleString()}</td>
                <td className="px-3 py-2 text-text-muted">{fmtDate(r.updated)}</td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button onClick={() => preview(r.id)} className="text-text-muted hover:text-primary text-xs transition-colors">view</button>
                  <button onClick={() => del(r.id)} className="text-danger hover:text-danger/70 text-xs transition-colors">delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-text-muted text-xs">
        Payloads appear under the Global Injection menu with id <code className="font-mono">f:custom:&lt;name&gt;</code>.
        Optional per-file category: first line <code className="font-mono">cat: pentest|coding|creative|general</code>.
      </p>
    </div>
  );
}
