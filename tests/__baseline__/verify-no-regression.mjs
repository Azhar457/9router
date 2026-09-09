// Gate: compares the current test results with the baseline known-fails list.
// PASS when no test that used to pass now fails. New tests are always allowed.
// Usage: node tests/__baseline__/verify-no-regression.mjs <current-results.json>
import { readFileSync } from "fs";

const knownFails = new Set(
  readFileSync(new URL("./known-fails.txt", import.meta.url), "utf8")
    .split("\n").map(s => s.trim())
    .filter(Boolean)
    .filter(s => !s.startsWith("#"))
);

const resultsPath = process.argv[2];
if (!resultsPath) { console.error("Missing results.json path"); process.exit(2); }

const r = JSON.parse(readFileSync(resultsPath, "utf8"));
const nowFails = r.testResults.flatMap(f => {
  // f.name is an absolute path whose prefix differs per checkout (upstream CI
  // runs in /app; local clones live anywhere). Keep only the repo-relative part
  // so known-fails.txt entries ("tests/...") match everywhere.
  const rel = f.name.replace(/^.*?(tests\/)/, "$1");
  return f.assertionResults.filter(a => a.status === "failed")
    .map(a => rel + " :: " + a.fullName);
});

// Regression = fail bây giờ NHƯNG không có trong baseline known-fails
const regressions = nowFails.filter(f => !knownFails.has(f));

if (regressions.length) {
  console.error(`\n❌ REGRESSION: ${regressions.length} test pass→fail:\n`);
  regressions.forEach(f => console.error("  - " + f));
  process.exit(1);
}
console.log(`✅ No regression. (now fails=${nowFails.length}, baseline known=${knownFails.size}, all known)`);
