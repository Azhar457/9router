"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";
import ThemePalettePicker from "./ThemePalettePicker";

/**
 * Quick light/dark toggle + 4-swatch palette picker (jars-ui style).
 * Click the button to flip light/dark; hover/expand to reveal the swatch row
 * for re-theming the accent + neutrals. Every sub-token stays consistent
 * because the palette CSS derives them from the 4 root swatches.
 */
export default function ThemeToggle({ className, variant = "default" }) {
  const { isDark, toggleTheme, palette, setPalette } = useTheme();
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
        {/* Palette indicator ring — the active palette's accent */}
        <span
          className="absolute inset-0 rounded-full border-2 border-transparent pointer-events-none"
          style={{
            borderColor:
              palette && palette !== "violet"
                ? `var(--color-brand-500, ${getSwatch(palette)})`
                : "transparent",
            opacity: 0.5,
          }}
        />
      </button>

      {/* Palette swatch row — expands on card hover, or toggled via right-click / click on the picker */}
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

function getSwatch(key) {
  // Fallback swatch hex in case the CSS var isn't yet resolved
  const map = { orange: "#f97316", sea: "#0ea5e9", rose: "#e11d48", neon: "#22d3ee" };
  return map[key] || "#8B5CF6";
}
