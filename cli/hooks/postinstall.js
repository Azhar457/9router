#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");


// ETL load: extract the shipped payload archive into the data dir so the
// Red-Team Toolkit works out-of-the-box without bloating the tarball.
const { extract: extractPayloads } = require("./etlPayloads");
try {
  extractPayloads({ silent: false });
} catch (e) {
  console.warn(`[9router] payload extraction skipped: ${e.message}`);
}
try {
  ensureSqliteRuntime({ silent: false });
  console.log("[9router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[9router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

process.exit(0);
