// Aurora Violet palette for 9router-plinian (UI-Playground-beta #15)
// Light theme: cool neutrals, violet-tinted accents
// Dark theme: deep indigo, violet highlights
// This is the JS mirror of the CSS token source (src/app/globals.css).
// Keep the two in sync — stylelint bans literal hex outside globals.css,
// so new colors must land in that file first.

export const COLORS = {
  // Primary — Aurora violet
  primary: {
    DEFAULT: "#8B5CF6",
    hover: "#7C3AED",
    light: "#C4B5FD",
    dark: "#6D28D9",
  },

  // Light theme backgrounds
  light: {
    bg: "#FAFAFA",
    bgAlt: "#F3F4F6",
    surface: "#FFFFFF",
    sidebar: "rgba(255, 255, 255, 0.85)",
    border: "rgba(0, 0, 0, 0.1)",
    textMain: "#1E293B",
    textMuted: "#64748B",
  },

  // Dark theme backgrounds
  dark: {
    bg: "#0C0A1A",
    bgAlt: "#12101F",
    surface: "#151226",
    sidebar: "rgba(18, 16, 31, 0.85)",
    border: "rgba(255, 255, 255, 0.1)",
    textMain: "#E2E8F0",
    textMuted: "#94A3B8",
  },

  // Status colors
  status: {
    success: "#22C55E",
    successLight: "#DCFCE7",
    successDark: "#166534",
    warning: "#F59E0B",
    warningLight: "#FEF3C7",
    warningDark: "#92400E",
    error: "#EF4444",
    errorLight: "#FEE2E2",
    errorDark: "#991B1B",
    info: "#3B82F6",
    infoLight: "#DBEAFE",
    infoDark: "#1E40AF",
  },
};

// CSS Variables mapping for Tailwind
export const CSS_VARIABLES = {
  light: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.light.bg,
    "--color-bg-alt": COLORS.light.bgAlt,
    "--color-surface": COLORS.light.surface,
    "--color-sidebar": COLORS.light.sidebar,
    "--color-border": COLORS.light.border,
    "--color-text-main": COLORS.light.textMain,
    "--color-text-muted": COLORS.light.textMuted,
  },
  dark: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.dark.bg,
    "--color-bg-alt": COLORS.dark.bgAlt,
    "--color-surface": COLORS.dark.surface,
    "--color-sidebar": COLORS.dark.sidebar,
    "--color-border": COLORS.dark.border,
    "--color-text-main": COLORS.dark.textMain,
    "--color-text-muted": COLORS.dark.textMuted,
  },
};
