#!/usr/bin/env node
/**
 * Add Strix / Penetration / SKILL-ROUTER-STRIX UI literals to every locale
 * in public/i18n/literals.
 *
 * source-English keys in scripts/i18n-literals-strix.json get real
 * translations for the 12 translated locales (id, ja, ko, es, fr, de,
 * pt-BR, zh-CN, ru, tr, vi, th); all other locales get null → runtime
 * translate() falls back to the English source string.
 *
 * Idempotent: existing keys are never overwritten.
 *
 * Usage: node scripts/i18n-add-strix-literals.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LITERALS_DIR = new URL("../public/i18n/literals/", import.meta.url);
const DATA_PATH = new URL("./i18n-literals-strix.json", import.meta.url);

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
