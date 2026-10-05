#!/usr/bin/env node
/**
 * Merge the pointer-mode literals (scripts/i18n-literals-strix-pointer.json)
 * into every locale file in public/i18n/literals.
 *
 * Same contract as i18n-add-strix-literals.mjs: idempotent (never overwrites
 * an existing key), real translations for id / zh-CN / ja / ko / es / fr /
 * de / pt-BR / ru / tr / vi / th, null → runtime falls back to English source.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LITERALS_DIR = new URL("../public/i18n/literals/", import.meta.url);
const DATA_PATH = new URL("./i18n-literals-strix-pointer.json", import.meta.url);

const DATA = JSON.parse(readFileSync(DATA_PATH, "utf8"));

const files = readdirSync(LITERALS_DIR).filter((f) => f.endsWith(".json"));
let slots = 0, translated = 0, fallback = 0;

for (const file of files) {
  const locale = file.replace(/\.json$/, "");
  const path = join(LITERALS_DIR.pathname, file);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  let wrote = 0;
  for (const key of Object.keys(DATA)) {
    if (key in raw) continue;
    const t = DATA[key][locale];
    raw[key] = t !== undefined ? t : null;
    if (t !== undefined) translated++; else fallback++;
    slots++;
    wrote++;
  }
  if (wrote) writeFileSync(path, JSON.stringify(raw, null, 2) + "\n");
  console.log(`${file.padEnd(12)} +${wrote}`);
}
console.log(`\nDone — ${slots} literal slots: ${translated} real translations + ${fallback} null (English fallback).`);
