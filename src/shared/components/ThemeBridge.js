"use client";

import { useLayoutEffect } from "react";

// Executes the first-paint theme + font-ready script on the client, appended to
// <head> via the DOM API so no <script> element ever appears inside React's
// render tree (Next 16 / React 19 dev build flags <script> rendered through
// JSX with "Encountered a script tag while rendering React component").
//
// useLayoutEffect fires before the browser paints, so the theme class lands
// before the first visible frame — same anti-FOUC behavior as the old inline
// head script, minus the dev warning. The script body is passed as a plain
// string (the identical code the root layout used to inline).
export default function ThemeBridge({ script }) {
  useLayoutEffect(() => {
    if (!script) return;
    const el = document.createElement("script");
    el.textContent = script;
    document.head.appendChild(el);
    el.remove();
  }, [script]);

  return null;
}
