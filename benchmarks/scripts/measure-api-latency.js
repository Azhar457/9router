#!/usr/bin/env node
// 9router API-latency benchmark — pre/post migration performance baseline.
//
// Measures per-endpoint latency of the auth-free 9router endpoints (mean,
// p50, p95, p99, stddev, error rate) and writes JSON to
// benchmarks/baseline/api-latency.json. The same output file is reused by
// post-implementation runs; feed it to compare.mjs.
//
// Endpoint policy: static, code-derived. /v1/* is the OpenAI-compatible
// public surface (auth via API key inside the handler), /api/health and
// /api/version are dashboardGuard PUBLIC_API_PATHS. The 401 responses from
// chat endpoints without credentials are the correct, identical pre/post
// behavior and are counted as success; their status distribution is
// recorded so post-comparison verifies the auth surface did not change.
//
// Env:
//   BENCHMARK_URL       target base URL            (default http://localhost:20128)
//   BENCHMARK_REQUESTS  requests per endpoint       (default 100)
//   BENCHMARK_API_KEY   Bearer key for /v1/*       (default none)
//   BENCHMARK_OUT       output dir                (default <repo>/benchmarks/baseline)

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const BASE_URL = (process.env.BENCHMARK_URL || "http://localhost:20128").replace(/\/+$/, "");
const NUM_REQUESTS = Math.max(1, parseInt(process.env.BENCHMARK_REQUESTS || "100", 10));
const WARMUP_REQUESTS = 5;
const CONCURRENCY = 1; // serial: we measure per-request latency, not throughput
const API_KEY = process.env.BENCHMARK_API_KEY || "";

// Static endpoint registry (code-derived, see header comment).
// chatProbe carries a trivial single-token prompt: with no key it short-circuits
// at the handler's auth check (~10ms, no provider traffic); with BENCHMARK_API_KEY
// it exercises one real routed completion. Either mode is safe and identical
// across baseline/compare runs.
const ENDPOINTS = [
  { path: "/api/health", method: "GET", label: "Health (public)" },
  { path: "/api/version", method: "GET", label: "Version (public)" },
  { path: "/v1/models", method: "GET", label: "V1 Models (public LLM)" },
  { path: "/api/v1/models", method: "GET", label: "V1 Models alias (public LLM)" },
  {
    path: "/v1/chat/completions",
    method: "POST",
    label: "V1 Chat (LLM proxy)",
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    },
  },
];

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((sorted.length * p) / 100) - 1);
  return sorted[Math.max(0, idx)];
}

function round2(n) {
  return n === null ? null : Math.round(n * 100) / 100;
}

function computeStats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : 0;
  const variance = n ? sorted.reduce((a, x) => a + (x - mean) ** 2, 0) / n : 0;
  return {
    count: n,
    mean_ms: round2(mean),
    p50_ms: round2(percentile(sorted, 50)),
    p95_ms: round2(percentile(sorted, 95)),
    p99_ms: round2(percentile(sorted, 99)),
    stddev_ms: round2(Math.sqrt(variance)),
    min_ms: n ? round2(sorted[0]) : null,
    max_ms: n ? round2(sorted[n - 1]) : null,
  };
}

function makeRequest(endpoint) {
  const headers = { "User-Agent": "9router-bench/1.0", "Accept": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  let body;
  if (endpoint.method === "POST") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(endpoint.body);
  }
  return fetch(`${BASE_URL}${endpoint.path}`, {
    method: endpoint.method,
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
}

async function measureEndpoint(endpoint) {
  console.log(`\n>> ${endpoint.label}  ${endpoint.method} ${endpoint.path}  (${NUM_REQUESTS} req)`);
  const latencies = [];
  const statusCounts = {};
  let errors = 0;
  let timedOut = 0;

  for (let i = 0; i < WARMUP_REQUESTS; i++) {
    try {
      const res = await makeRequest(endpoint);
      await res.arrayBuffer(); // drain so warmup does not overlap measurement
    } catch {}
  }

  for (let i = 0; i < NUM_REQUESTS; i++) {
    const start = performance.now();
    let status = 0;
    try {
      const res = await makeRequest(endpoint);
      status = res.status;
      await res.arrayBuffer();
      latencies.push(performance.now() - start);
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (status >= 400 && status !== 401) errors += 1; // 401 = expected auth-free probe
    } catch (err) {
      const now = performance.now();
      if (err?.name === "TimeoutError" || err?.name === "AbortError") timedOut += 1;
      else errors += 1;
    }
  }

  const stats = computeStats(latencies);
  const result = {
    endpoint: endpoint.path,
    label: endpoint.label,
    method: endpoint.method,
    requests: NUM_REQUESTS,
    stats,
    errors,
    timed_out: timedOut,
    error_rate_pct: round2(((errors + timedOut) / NUM_REQUESTS) * 100),
    status_distribution: statusCounts,
  };

  console.log(
    `   mean=${stats.mean_ms}ms p50=${stats.p50_ms}ms p95=${stats.p95_ms}ms ` +
    `p99=${stats.p99_ms}ms sd=${stats.stddev_ms}ms err=${errors + timedOut}/${NUM_REQUESTS} ` +
    `statuses=${JSON.stringify(statusCounts)}`
  );
  return result;
}

function checkReachable() {
  return fetch(`${BASE_URL}/api/health`, { method: "GET", signal: AbortSignal.timeout(5_000) })
    .then((res) => {
      if (res.status !== 200) {
        throw new Error(`/api/health responded ${res.status} — is the target the 9router instance?`);
      }
    })
    .catch((err) => {
      console.error(`ERROR: cannot reach ${BASE_URL}/api/health: ${err.message}`);
      console.error("Start the dashboard first (npm start on port 20128), or pass BENCHMARK_URL.");
      process.exit(1);
    });
}

async function main() {
  console.log("9router API-latency benchmark");
  console.log(`target: ${BASE_URL}   requests/endpoint: ${NUM_REQUESTS}   api key: ${API_KEY ? "yes" : "no (public/auth-free probes)"}`);
  await checkReachable();

  const results = [];
  for (const endpoint of ENDPOINTS) {
    results.push(await measureEndpoint(endpoint));
  }

  const outDir = process.env.BENCHMARK_OUT || join(repoRoot, "benchmarks", "baseline");
  const outFile = join(outDir, "api-latency.json");
  const output = {
    benchmark: "api-latency",
    generated_at: new Date().toISOString(),
    tool: "measure-api-latency.js",
    target: BASE_URL,
    requests_per_endpoint: NUM_REQUESTS,
    api_key_used: Boolean(API_KEY),
    // Post-compare flags: error rate and status distribution may NOT regress
    // (UI-only change keeps the auth surface identical).
    results,
    summary: {
      endpoints: results.length,
      total_errors: results.reduce((a, r) => a + r.errors + r.timed_out, 0),
      total_requests: NUM_REQUESTS * results.length,
    },
  };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nwrote ${outFile}`);
}

main().catch((err) => {
  console.error("benchmark failed:", err.message);
  process.exit(1);
});
