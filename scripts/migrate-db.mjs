#!/usr/bin/env node
// migrate-db.mjs — Migrate 9Router production DB config to a target SQLite DB.
//
// Usage:
//   node scripts/migrate-db.mjs [--source <path>] [--target <path>]
//                                [--tables all|connections|nodes|apikeys|combos|kv|settings]
//                                [--dry-run] [--force]
//
//   --source    Source SQLite DB (default: ~/.9router/db/data.sqlite)
//   --target    Target SQLite DB (required, or default to --dry-run only)
//   --tables    Which tables to copy (default: all config tables)
//   --dry-run   Print what would be copied without writing
//   --force     Required for any actual write (safety)
//
// What it copies:
//   settings, providerNodes, apiKeys, providerConnections, combos, kv
//   (usageHistory, usageDaily, requestDetails are log data — skipped by default)
//
// Safety:
//   - Source DB opened readonly
//   - API key values are masked in all output (never printed in full)
//   - All writes wrapped in a single transaction
//   - --force required for any write

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const Database = require(path.join(REPO_ROOT, 'node_modules', 'better-sqlite3'));

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const TABLE_ORDER = ['settings', 'providerNodes', 'apiKeys', 'providerConnections', 'combos', 'kv'];
const SKIP_TABLES = ['usageHistory', 'usageDaily', 'requestDetails', '_meta'];

// Primary keys per table (for upsert logic)
const PRIMARY_KEYS = {
  settings: 'id',
  providerNodes: 'id',
  apiKeys: 'id',
  providerConnections: 'id',
  combos: 'id',
  kv: 'key',
};

function maskKey(val) {
  if (typeof val !== 'string' || val.length < 8) return '(masked)';
  return val.slice(0, 4) + '...' + val.slice(-4);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const source = args.source || path.join(os.homedir(), '.9router', 'db', 'data.sqlite');
  const target = args.target || null;
  const dryRun = !!args['dry-run'];
  const force = !!args.force;
  const tablesArg = args.tables || 'all';

  const tablesToCopy = TABLE_ORDER.filter((t) => {
    if (tablesArg === 'all') return !SKIP_TABLES.includes(t);
    const map = {
      connections: 'providerConnections',
      nodes: 'providerNodes',
      apikeys: 'apiKeys',
      combos: 'combos',
      kv: 'kv',
      settings: 'settings',
    };
    return map[tablesArg] === t;
  });

  console.log('9Router DB Migration');
  console.log('  source:', source);
  console.log('  target:', target || '(dry-run only)');
  console.log('  tables:', tablesToCopy.join(', '));
  console.log('  mode:  ', dryRun ? 'dry-run' : force ? 'write' : 'dry-run (add --force to write)');
  console.log('');

  if (!fs.existsSync(source)) {
    console.error('ERROR: source DB not found:', source);
    process.exit(1);
  }

  // Open source readonly
  const srcDb = new Database(source, { readonly: true });

  // Count rows in source
  const sourceCounts = {};
  for (const t of tablesToCopy) {
    try {
      sourceCounts[t] = srcDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    } catch {
      sourceCounts[t] = null; // table doesn't exist in source
    }
  }

  console.log('Source row counts:');
  for (const [t, n] of Object.entries(sourceCounts)) {
    console.log(`  ${t}: ${n ?? '(not found)'}`);
  }

  // Mask and show sample credential info (no real values)
  console.log('');
  console.log('Credential summary (masked):');
  try {
    const conns = srcDb.prepare('SELECT provider, COUNT(*) as n FROM providerConnections GROUP BY provider').all();
    for (const c of conns) {
      console.log(`  ${c.provider}: ${c.n} connection(s)`);
    }
  } catch {}

  // Show apiKeys count
  try {
    const akCount = srcDb.prepare('SELECT COUNT(*) AS n FROM apiKeys').get().n;
    console.log(`  apiKeys: ${akCount} total`);
  } catch {}

  if (dryRun || !force) {
    console.log('');
    console.log('=== DRY RUN — no writes made ===');
    if (!dryRun && !force) {
      console.log('To perform the actual migration, add --force and --target <path>.');
    }
    srcDb.close();
    return;
  }

  // --- Write to target ---
  if (!target) {
    console.error('ERROR: --target required when --force is set.');
    srcDb.close();
    process.exit(1);
  }

  // Create target dir if needed
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const tgtDb = new Database(target);
  tgtDb.pragma('journal_mode = WAL');

  // Ensure schema exists in target (idempotent: skip tables that already exist).
  const schemaDdls = srcDb
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
    .all();
  for (const { name, sql } of schemaDdls) {
    try {
      tgtDb.exec(sql);
    } catch (e) {
      // Table/index already exists in target — safe to skip (merge case).
      if (!/already exists/i.test(e.message)) throw e;
    }
  }
  // Copy index DDL (skip internal + already-existing indexes)
  const indexDdls = srcDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
    .all();
  for (const { sql } of indexDdls) {
    try { tgtDb.exec(sql); } catch { /* index already exists — skip */ }
  }

  try {
    const runMigration = () => {
      for (const t of tablesToCopy) {
        const n = sourceCounts[t];
        if (n === null || n === 0) continue;

        // Get columns
        const cols = srcDb.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        const pk = PRIMARY_KEYS[t];
        const upsert = pk ? 'OR REPLACE' : '';

        const rows = srcDb.prepare(`SELECT ${cols.join(',')} FROM ${t}`).all();

        const insertSql = `INSERT ${upsert} INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
        const insertStmt = tgtDb.prepare(insertSql);

        for (const row of rows) {
          insertStmt.run(...cols.map((c) => row[c]));
        }

        const targetCount = tgtDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
        console.log(`  ${t}: copied ${rows.length} → target total ${targetCount}`);
      }
    };
    const tx = tgtDb.transaction(runMigration);
    tx();

    // Validate
    console.log('');
    console.log('Validation (source vs target):');
    for (const t of tablesToCopy) {
      const src = sourceCounts[t] ?? 0;
      const tgt = tgtDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      const status = src === tgt ? '✓' : '⚠';
      console.log(`  ${status} ${t}: src=${src} tgt=${tgt}`);
    }

    console.log('');
    console.log(`Migration complete → ${target}`);
    console.log(`API keys are stored in plaintext in SQLite. Protect this file with filesystem permissions.`);
  } finally {
    srcDb.close();
    tgtDb.close();
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
