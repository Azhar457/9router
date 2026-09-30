"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG, PALETTES } from "@/shared/constants/config";

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,
      palette: THEME_CONFIG.defaultPalette,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(get());
      },

      toggleTheme: () => {
        const currentTheme = get().theme;
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        set({ theme: newTheme });
        applyTheme(get());
      },

      setPalette: (palette) => {
        if (!PALETTES[palette]) return;
        set({ palette });
        applyTheme(get());
      },

      initTheme: () => {
        applyTheme(get());
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
    }
  )
);

// Apply theme + palette to the document root.
// - .dark class drives the light/dark mode
// - [data-palette] drives the 4-swatch accent + neutral re-theming
function applyTheme({ theme, palette }) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  const effectiveTheme = theme === "system" ? systemTheme : theme;

  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // Palette: omit the attribute for the default violet so :root defaults win
  if (palette && palette !== "violet" && PALETTES[palette]) {
    root.setAttribute("data-palette", palette);
  } else {
    root.removeAttribute("data-palette");
  }
}

export default useThemeStore;
