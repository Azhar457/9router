// Headless curation of the "unify" combo against the live DB.
// DATA_DIR MUST be set to /tmp/opencode/9router-data before this file runs
// (the loader's --import flag fires before the main entry, so the env is
// already in place by the time the repo modules read it at import time).
// Usage:
//   DATA_DIR=/tmp/opencode/9router-data \
//     node --import ./scripts/alias-loader.mjs scripts/curate-unify.mjs

if (!process.env.DATA_DIR || process.env.DATA_DIR !== "/tmp/opencode/9router-data") {
  console.error(`[curate-unify] DATA_DIR must point at the live data dir; got ${JSON.stringify(process.env.DATA_DIR)} — aborting so we never clobber the default ~/.9router`);
  process.exit(2);
}

const { curateFreeComboPerProvider } = await import("@/lib/modelCatalog/freeCombo.js");

const t0 = Date.now();
const result = await curateFreeComboPerProvider({ comboName: "unify" });
console.log(`[curate-unify] finished in ${Date.now() - t0}ms`);
console.log(
  JSON.stringify(
    {
      comboName: result.comboName,
      models: result.models,
      winners: result.winners,
      skippedCount: result.skipped.length,
      skipped: result.skipped.map((s) => ({ full: s.full, providerAlias: s.providerAlias, reason: s.reason, error: s.error })),
      error: result.error,
    },
    null,
    2
  )
);
