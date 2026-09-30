// Design-system lock: no hardcoded color values outside the token source file.
// enforces the 3-tier token architecture (primitive → semantic → component)
// by banning literal hex/named colors in CSS so developers reach for var(--*)
// instead of inventing new values.
//
// ponytail: we only extend the two rules that matter for color consistency.
// The broader stylelint-config-standard format rules are left off on purpose —
// the hand-written CSS in this repo does not follow them and 200+ pre-existing
// nits would bury the real lock. Re-tighten globally if the CSS gets
// reformatted.
export default {
  plugins: [],
  ignoreFiles: [
    "node_modules/**",
    ".next/**",
    ".next-standalone/**",
    "out/**",
  ],
  rules: {
    // --- DESIGN SYSTEM LOCK ---
    "color-no-hex": true,
    // named colors: allow only layout-transparent keywords.
    "color-named": [true, { ignoreValues: ["transparent"] }],

    // --- FORMAT rules: off (pre-existing code does not follow them) ---
    "rule-empty-line-before": null,
    "declaration-block-single-line-max-declarations": null,
    "no-descending-specificity": null,
    "max-nesting-depth": null,
    "import-notation": null,
    "keyframe-declaration-no-important": null,
    "declaration-block-no-duplicate-properties": null,
    "no-duplicate-selectors": null,
    
    "value-keyword-case": null,
    "custom-property-pattern": null,
    "alpha-value-notation": null,
    "color-function-notation": null,
  },
  overrides: [
    // The token source file is the single place where literal values are
    // allowed (the primitive tier of the 3-tier architecture). The macOS
    // traffic-light dots keep their system red/amber/green hexes — they are
    // semantic, not theme, and must stay recognizable regardless of theme.
    {
      files: ["src/app/globals.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
      },
    },
  ],
};
