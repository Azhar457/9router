import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    // Files excluded from the default run (kept in the repo on purpose):
    // - cursor-agent-proto: imports ~9 codec helpers (encodeAgentValue,
    //   encodeMcpToolDefinition, buildAgentRunFrame, …) that are module-private
    //   or absent in cursorProtobuf.js/cursor.js — dead test, identical upstream.
    // - cursor-models: mocks global.fetch but fetchCursorCatalog uses native
    //   http2 (agent.api5.cursor.sh is h2-only) — unmockable that way, upstream identical.
    // - embeddings.cloud: imports ../../cloud/src/handlers/embeddings.js — the
    //   cloud worker lives in a separate deployment, not this repo.
    // - *.live.test.js: hits real provider endpoints (MiMo) — network tests.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**",
      "**/cursor-agent-proto.test.js",
      "**/cursor-models.test.js",
      "**/embeddings.cloud.test.js",
      "**/*.live.test.js"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
