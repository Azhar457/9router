#!/usr/bin/env node
// migrate-media-node.mjs — Opsi B: declare node openai-compatible (e.g. ag-ai)
// sebagai media provider + retype custom models sesuai nama.
//
// 1. Baca data: semua providerNodes + customModels dari backup JSON (atau DB live).
// 2. Auto-detect serviceKinds dari nama custom models:
//    /image|imagen|dall-?e|flux|sdxl/ → image
//    /video/ → video
//    /embed/ → embedding
//    /tts|speech|audio|voice/ → tts
// 3. Update node.providerNodes.data.serviceKinds (merge, tidak replace).
// 4. Retype custom models: hapus row `providerAlias|id|llm`, bikin
//    `providerAlias|id|<newtype>` (via /api/models/custom, atau DB
//    langsung kalau --db).
//
// Keamanan:
//   - --dry-run default. Tambah --force buat nulis.
//   - --db path sqlite langsung (WAL safe, pola migrate-db.mjs).
//   - --http URL base server (default http://127.0.0.1:20128) — nulis
//     via API (putar lewat dashboardGuard).
//   - --node <nodeId|prefix> scope: cuma proses node tsb. Default: semua
//     node openai-compatible / anthropic-compatible / custom-embedding.
//
// Contoh:
//   # 1. Dry-run dari backup
//   node scripts/migrate-media-node.mjs --from /mnt/data_d/9router-backup-new.json
//
//   # 2. Tulis via API (server harus jalan + log in)
//   node scripts/migrate-media-node.mjs --force --http http://127.0.0.1:20128 --node ag-ai
//
//   # 3. Tulis langsung ke DB (server stop dulu)
//   node scripts/migrate-media-node.mjs --force --db ~/.9router/db/data.sqlite --node ag-ai

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const require = createRequire(import.meta.url);

// ── Argument parsing ─────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const dryRun = !args.force;
const fromBackup = args.from || null;
const dbPath = args.db || null;
const httpBase = args.http || null;
const nodeIdOrPrefix = args.node || null;

// ── Auto-detect rules ────────────────────────────────────────────────
// Nama model → service kind. Urutan: embedding > tts > video > image > llm.
// (video di-sebelum image: "video" sering mengandung "clip" bukan "image".
//  image di-cari setelah video biar "agnes-image-2.5" gak keclaim "video".)
function inferServiceKind(modelId) {
  const lower = String(modelId || "").toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/video|film|clip/.test(lower)) return "video";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion|banana|pic/.test(lower)) return "image";
  return "llm";
}

// ── Load data ────────────────────────────────────────────────────────
async function loadData() {
  if (fromBackup) {
    const raw = JSON.parse(fs.readFileSync(fromBackup, "utf8"));
    return {
      providerNodes: raw.providerNodes || [],
      customModels: raw.customModels || [],
      providerConnections: raw.providerConnections || [],
    };
  }
  if (dbPath) {
    const Database = require(path.join(REPO_ROOT, "node_modules", "better-sqlite3"));
    const db = new Database(dbPath, { readonly: true });
    // providerNodes: prefix lives inside the JSON `data` column, not a column.
    const nodes = db
      .prepare("SELECT id, type, name, data FROM providerNodes")
      .all()
      .map((r) => {
        const d = JSON.parse(r.data || "{}");
        return { id: r.id, type: r.type, name: r.name, prefix: d.prefix, serviceKinds: d.serviceKinds || [], ...d };
      });
    const models = db
      .prepare("SELECT value FROM kv WHERE scope = 'customModels'")
      .all()
      .map((r) => JSON.parse(r.value));
    db.close();
    return { providerNodes: nodes, customModels: models, providerConnections: [] };
  }
  throw new Error("Specify --from <backup.json> or --db <path.sqlite>");
}

// ── Compute plan ─────────────────────────────────────────────────────
function computePlan(data) {
  const { providerNodes, customModels } = data;

  // Filter nodes to process
  let nodes = providerNodes.filter((n) =>
    ["openai-compatible", "anthropic-compatible", "custom-embedding"].includes(n.type)
  );
  if (nodeIdOrPrefix) {
    nodes = nodes.filter(
      (n) => n.id === nodeIdOrPrefix || n.prefix === nodeIdOrPrefix || n.name === nodeIdOrPrefix
    );
  }

  const plan = { nodes: [], modelRetypes: [] };
  for (const node of nodes) {
    // Custom models registered under this node (providerAlias = node.id,
    // atau prefix jika user pakai prefix-based model alias).
    const modelsForNode = customModels.filter(
      (m) => m.providerAlias === node.id || m.providerAlias === node.prefix
    );

    // Auto-detect serviceKinds from model names
    const detected = new Set();
    for (const m of modelsForNode) {
      const kind = inferServiceKind(m.id);
      if (kind !== "llm") detected.add(kind);
    }

    // Merge with existing serviceKinds
    const existing = Array.isArray(node.serviceKinds) ? node.serviceKinds : [];
    const merged = [...new Set([...existing, ...detected])];

    if (merged.length !== existing.length) {
      plan.nodes.push({
        id: node.id,
        prefix: node.prefix,
        name: node.name,
        currentKinds: existing,
        newKinds: merged,
        added: [...detected].filter((k) => !existing.includes(k)),
      });
    }

    // Model retype plan: only retype when type mismatches auto-detect
    for (const m of modelsForNode) {
      const targetKind = inferServiceKind(m.id);
      const currentType = m.type || "llm";
      if (targetKind !== "llm" && currentType === "llm") {
        plan.modelRetypes.push({
          providerAlias: m.providerAlias,
          id: m.id,
          from: currentType,
          to: targetKind,
          name: m.name,
        });
      }
    }
  }

  return plan;
}

// ── Print plan ───────────────────────────────────────────────────────
function printPlan(plan, source) {
  console.log("9Router Media Node Migration");
  console.log("  source:", source);
  console.log("  mode:  ", dryRun ? "dry-run (add --force to apply)" : "apply");
  console.log("");

  console.log(`Node serviceKings updates: ${plan.nodes.length}`);
  for (const n of plan.nodes) {
    console.log(`  ${n.id}`);
    console.log(`    prefix: ${n.prefix}  name: ${n.name}`);
    console.log(`    current: [${n.currentKinds.join(", ") || "(none)"}]`);
    console.log(`    new:     [${n.newKinds.join(", ")}]`);
    console.log(`    added:   [${n.added.join(", ")}]`);
  }

  console.log("");
  console.log(`Model retype: ${plan.modelRetypes.length}`);
  for (const m of plan.modelRetypes) {
    console.log(`  ${m.providerAlias}/${m.id}  ${m.from} → ${m.to}`);
  }
}

// ── Apply: DB mode ───────────────────────────────────────────────────
function applyDb(dbPath, plan) {
  const Database = require(path.join(REPO_ROOT, "node_modules", "better-sqlite3"));
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Backup current data first
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  fs.copyFileSync(dbPath, `${dbPath}.bak-migrate-media-${ts}`);
  console.log(`Backup → ${dbPath}.bak-migrate-media-${ts}`);

  const tx = db.transaction(() => {
    // 1. Update node serviceKinds
    for (const n of plan.nodes) {
      const row = db.prepare("SELECT data FROM providerNodes WHERE id = ?").get(n.id);
      if (!row) continue;
      const data = JSON.parse(row.data || "{}");
      data.serviceKinds = n.newKinds;
      db.prepare("UPDATE providerNodes SET data = ?, updatedAt = ? WHERE id = ?").run(
        JSON.stringify(data),
        new Date().toISOString(),
        n.id
      );
    }

    // 2. Retype custom models: delete old llm row + insert new type row
    for (const m of plan.modelRetypes) {
      const oldKey = `${m.providerAlias}|${m.id}|${m.from}`;
      const newRow = {
        providerAlias: m.providerAlias,
        id: m.id,
        type: m.to,
        name: m.name || m.id,
      };
      db.prepare("DELETE FROM kv WHERE scope = 'customModels' AND key = ?").run(oldKey);
      db.prepare("INSERT INTO kv (scope, key, value) VALUES ('customModels', ?, ?)").run(
        `${m.providerAlias}|${m.id}|${m.to}`,
        JSON.stringify(newRow)
      );
    }
  });
  tx();
  db.close();
}

// ── Apply: HTTP mode ────────────────────────────────────────────────
async function applyHttp(base, plan) {
  const url = (p) => `${base.replace(/\/$/, "")}${p}`;

  // 1. Node serviceKinds: PUT /api/provider-nodes/{id}
  //    (route butuh semua field: name, prefix, apiType, baseUrl — baca dulu.)
  for (const n of plan.nodes) {
    const getNode = await fetch(url(`/api/provider-nodes/${n.id}`)).then((r) => r.json());
    if (!getNode?.node) throw new Error(`GET node ${n.id} failed: ${JSON.stringify(getNode)}`);
    const existing = getNode.node;
    const putBody = {
      name: existing.name,
      prefix: existing.prefix,
      baseUrl: existing.baseUrl,
      apiType: existing.apiType || "chat",
      serviceKinds: n.newKinds,
    };
    const res = await fetch(url(`/api/provider-nodes/${n.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(putBody),
    });
    if (!res.ok) throw new Error(`PUT node ${n.id} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`  node ${n.prefix} → serviceKinds [${n.newKinds.join(", ")}]`);
  }

  // 2. Model retype: DELETE old llm row + POST new type row
  for (const m of plan.modelRetypes) {
    const delUrl = `${url(`/api/models/custom`)}?providerAlias=${encodeURIComponent(m.providerAlias)}&id=${encodeURIComponent(m.id)}&type=${encodeURIComponent(m.from)}`;
    const delRes = await fetch(delUrl, { method: "DELETE" });
    if (!delRes.ok && delRes.status !== 404) {
      console.warn(`  warn: DELETE ${m.id} (${m.from}) → ${delRes.status}`);
    }
    const postRes = await fetch(url("/api/models/custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerAlias: m.providerAlias,
        id: m.id,
        type: m.to,
        name: m.name,
      }),
    });
    if (!postRes.ok) throw new Error(`POST model ${m.id} → ${postRes.status}: ${(await postRes.text()).slice(0, 200)}`);
    console.log(`  model ${m.id}: ${m.from} → ${m.to}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const source = fromBackup || dbPath || "unknown";
  const data = await loadData();
  const plan = computePlan(data);
  printPlan(plan, source);

  if (plan.nodes.length === 0 && plan.modelRetypes.length === 0) {
    console.log("\nNo changes needed — all nodes/models already correct.");
    return;
  }

  if (dryRun) {
    console.log("\n=== DRY RUN — nothing written ===");
    if (args.http || args.db) {
      console.log(`To apply, re-run with --force${args.db ? " (uses --db)" : " (uses --http or --db)"}: `);
    }
    return;
  }

  if (dbPath) {
    applyDb(dbPath, plan);
  } else if (httpBase) {
    await applyHttp(httpBase, plan);
  } else {
    throw new Error("Specify --db <path> or --http <url> with --force");
  }

  console.log(`\nApplied: ${plan.nodes.length} node(s), ${plan.modelRetypes.length} model retype(s).`);
  console.log("Restart /v1/models cache (or wait for next fetch) to see updated media tabs.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
