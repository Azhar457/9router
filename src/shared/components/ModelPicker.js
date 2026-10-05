"use client";

// ModelPicker — searchable multi-select for choosing models to race/compare.
//
// Replaces the old one-native-<select>-per-provider row, which had two real
// problems: the option list is clipped by the OS popup (long model ids get
// cut off mid-word), and with 60+ models you had to scroll a dropdown per
// provider to find one. This is a single combobox with live filtering, grouped
// by provider, keyboard support, and removable chips for what's selected.
//
// Selection state stays owned by the parent (controlled component) so it can
// keep persisting to localStorage exactly as before.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";

function scoreMatch(needle, haystack) {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  const at = h.indexOf(n);
  if (at === -1) return -1;
  // Prefer matches at a word boundary / prefix over mid-word ones.
  const boundary = at === 0 || /[\s/._-]/.test(h[at - 1]);
  return (boundary ? 2 : 1) * 1000 - at;
}

export default function ModelPicker({
  groups = [],
  selected = [],
  onToggle,
  onClear,
  placeholder,
  emptyLabel,
  maxVisible = 240,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const modelById = useMemo(() => {
    const map = new Map();
    for (const g of groups) for (const m of g.models) if (!map.has(m.id)) map.set(m.id, m);
    return map;
  }, [groups]);

  // Flattened, filtered, and scored. Providers with zero matches drop out
  // entirely so the list never shows an empty heading.
  const results = useMemo(() => {
    const q = query.trim();
    const out = [];
    for (const group of groups) {
      const items = [];
      for (const m of group.models) {
        if (q) {
          const byName = scoreMatch(q, m.name || "");
          const byId = scoreMatch(q, m.id || "");
          const best = Math.max(byName, byId);
          if (best < 0) continue;
          items.push({ model: m, score: best });
        } else {
          items.push({ model: m, score: 0 });
        }
      }
      if (items.length) out.push({ group, items });
    }
    if (q) {
      for (const g of out) g.items.sort((a, b) => b.score - a.score);
      out.sort((a, b) => (b.items[0]?.score ?? 0) - (a.items[0]?.score ?? 0));
    }
    return out;
  }, [groups, query]);

  const flat = useMemo(() => {
    const arr = [];
    for (const g of results) for (const it of g.items) arr.push(it.model.id);
    return arr;
  }, [results]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = flat[highlight];
      if (id) onToggle(id);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && selected.length) {
      onToggle(selected[selected.length - 1]);
    }
  };

  let flatIdx = -1;

  return (
    <div className="flex flex-col gap-2" ref={rootRef}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-text-main"
            >
              <span className="truncate">{modelById.get(id)?.name || id}</span>
              <button
                type="button"
                aria-label={`${translate("Remove")} ${id}`}
                onClick={() => onToggle(id)}
                className="shrink-0 text-text-muted hover:text-red-500"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-text-muted hover:text-red-500"
          >
            {translate("Clear")}
          </button>
        </div>
      )}

      {/* Combobox */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          <span className="material-symbols-outlined text-[18px]">search</span>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder || translate("Search models…")}
          role="combobox"
          aria-expanded={open}
          aria-controls="model-picker-list"
          className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-text-main outline-none focus:border-primary/50"
        />
      </div>

      {open && (
        <div
          id="model-picker-list"
          ref={listRef}
          role="listbox"
          className="max-h-[280px] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-text-muted">
              {emptyLabel || translate("No models match.")}
            </p>
          ) : (
            results.map(({ group, items }) => (
              <div key={group.providerId}>
                <div className="sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {group.providerName}
                  <span className="ml-1 font-normal normal-case">({items.length})</span>
                </div>
                {items.slice(0, maxVisible).map(({ model }) => {
                  flatIdx += 1;
                  const idx = flatIdx;
                  const isSel = selectedSet.has(model.id);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      data-idx={idx}
                      role="option"
                      aria-selected={isSel}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => onToggle(model.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        highlight === idx ? "bg-surface-2" : "hover:bg-surface-2/60",
                        isSel && "text-primary"
                      )}
                    >
                      <span className="truncate">{model.name}</span>
                      {isSel && (
                        <span className="material-symbols-outlined shrink-0 text-[15px]">
                          check
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}