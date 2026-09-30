"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import ThemePalettePicker from "./ThemePalettePicker";

/**
 * Light/dark toggle. Palette picking: PaletteToggle (header), sidebar dots,
 * or right-click here.
 */
export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const variants = {
    default: cn(
      "relative flex items-center gap-1",
      "text-text-muted hover:text-text-main transition-colors"
    ),
    card: cn(
      "relative flex items-center gap-2",
      "bg-surface/60 hover:bg-surface",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-[var(--shadow-warm)]",
      "text-text-muted hover:text-brand-500",
      "transition-all rounded-full"
    ),
  };

  const modeIcon = isDark ? "light_mode" : "dark_mode";
  const sizeCls = variant === "card" ? "size-11 rounded-full" : "size-10 rounded-full";

  return (
    <div
      ref={ref}
      className={cn("relative flex items-center", className)}
      onMouseEnter={() => variant === "card" && setOpen(true)}
      onMouseLeave={() => variant === "card" && setOpen(false)}
    >
      <button
        onClick={toggleTheme}
        onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
        className={cn(variants[variant], sizeCls)}
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        title={`Switch to ${isDark ? "light" : "dark"} mode`}
      >
        <span
          className={cn(
            "material-symbols-outlined text-[22px]",
            variant === "card" && "transition-transform duration-300 group-hover:rotate-12"
          )}
        >
          {modeIcon}
        </span>
      </button>

      {/* Palette swatch row — opens on right-click (or card hover) */}
      {open && (
        <div
          className={cn(
            "absolute right-0 top-full mt-2 px-3 py-2",
            "bg-surface border border-black/10 dark:border-white/10",
            "rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
          )}
          onClick={() => setOpen(false)}
        >
          <ThemePalettePicker />
        </div>
      )}
    </div>
  );
}

/**
 * Standalone palette picker button — same visual language as ThemeToggle,
 * one job: open the 4-swatch palette dropdown.
 */
export function PaletteToggle({ className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative flex items-center", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose palette"
        aria-expanded={open}
        title="Palette"
        className={cn(
          "relative flex items-center size-10 rounded-full",
          "text-text-muted hover:text-text-main transition-colors"
        )}
      >
        <span className="material-symbols-outlined text-[22px]">palette</span>
      </button>
      {open && (
        <div
          className={cn(
            "absolute right-0 top-full mt-2 px-3 py-2",
            "bg-surface border border-black/10 dark:border-white/10",
            "rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
          )}
          onClick={() => setOpen(false)}
        >
          <ThemePalettePicker />
        </div>
      )}
    </div>
  );
}
