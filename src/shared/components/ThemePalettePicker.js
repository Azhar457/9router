"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { PALETTES } from "@/shared/constants/config";
import { cn } from "@/shared/utils/cn";

/**
 * 4-swatch palette picker (ported from jars-ui). Renders one dot per palette;
 * the active one is ringed. Selecting one re-themes the whole UI — every
 * sub-token (surfaces, borders, text, glows) stays consistent because the
 * palette CSS in globals.css derives them from the 4 root swatches.
 */
export default function ThemePalettePicker({ className }) {
  const { palette, setPalette } = useTheme();
  const entries = Object.entries(PALETTES);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {entries.map(([key, p]) => {
        const active = palette === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setPalette(key)}
            title={p.label}
            aria-label={`Palette ${p.label}`}
            aria-pressed={active}
            className={cn(
              "relative flex items-center justify-center size-7 rounded-full transition-transform hover:scale-110",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            )}
          >
            {/* Swatch disc (the palette's primary accent) */}
            <span
              className="size-5 rounded-full border border-black/10 dark:border-white/10"
              style={{ background: p.swatch }}
            />
            {/* Active ring */}
            <span
              className={cn(
                "absolute inset-0 rounded-full transition-opacity",
                "border-2",
                active ? "border-primary opacity-100" : "border-transparent opacity-0"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
