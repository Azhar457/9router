// Guard for the fork's i18n coverage: the Payload/Injection, Penetration,
// Strix and Custom Payloads tabs are hand-written UI, so their strings only
// translate when public/i18n/literals/id.json has the exact rendered text as a
// key (the runtime matches whole text nodes, not words). These assertions catch
// a key being renamed in a component without the dictionary following.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dict = JSON.parse(readFileSync(join(root, "public/i18n/literals/id.json"), "utf8"));

const COMPONENTS = [
  "src/app/(dashboard)/dashboard/payload/GlobalInjectionClient.js",
  "src/app/(dashboard)/dashboard/payload/PayloadTabClient.js",
  "src/app/(dashboard)/dashboard/penetration/PenetrationTabClient.js",
  "src/app/(dashboard)/dashboard/strix/StrixTabClient.js",
  "src/app/(dashboard)/dashboard/custom-payloads/CustomPayloadsClient.js",
];

// Material Symbols render their icon name as the ligature text, and the runtime
// translates every text node — a dictionary key equal to an icon name would
// replace the glyph everywhere in the dashboard.
const ICON_LIGATURES = [
  "add", "arrow_back", "cancel", "check", "close", "content_copy", "delete",
  "download", "edit", "expand_less", "expand_more", "folder", "gavel", "info",
  "key", "lock", "open_in_new", "rename", "report_problem", "save", "search",
  "settings", "upload", "verified", "view", "visibility", "warning",
];

function translateKeys(file) {
  const source = readFileSync(join(root, file), "utf8");
  return [...source.matchAll(/translate\("((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\"/g, '"'),
  );
}

describe("id.json — fork tab coverage", () => {
  it("has every translate() key used by the fork tabs", () => {
    const missing = [];
    for (const file of COMPONENTS) {
      for (const key of translateKeys(file)) {
        if (!(key in dict)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no key that would shadow a Material Symbols ligature", () => {
    const collisions = ICON_LIGATURES.filter((name) => name in dict);
    expect(collisions).toEqual([]);
  });

  it("keeps {placeholder} names in sync with the source key", () => {
    const broken = [];
    for (const [key, value] of Object.entries(dict)) {
      const wanted = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      if (!wanted.length) continue;
      const got = [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      if (wanted.join() !== got.join()) broken.push(`${key} → ${value}`);
    }
    expect(broken).toEqual([]);
  });
});
