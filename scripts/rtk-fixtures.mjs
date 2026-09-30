// Generates Go rtk parity fixtures by running the JS implementation.
// Run: node scripts/rtk-fixtures.mjs   (from repo root)
import { compressMessages, formatRtkLog } from "../open-sse/rtk/index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "go", "rtk", "testdata");
mkdirSync(outDir, { recursive: true });

const grepOut = Array.from({ length: 40 }, (_, i) =>
  `src/file${i}.js:${100 + i}:  const secret_${i} = "value${i}"; // match ${i}`).join("\n");
const numbered = Array.from({ length: 300 }, (_, i) => `${String(i + 1).padStart(4)}|line content number ${i} ${"x".repeat(20)}`).join("\n");
const noisyLog = Array.from({ length: 400 }, (_, i) => (i % 7 === 0 ? "" : `WARN: retry ${i % 3} attempt for job ${i % 5}`)).join("\n");
const gitLogOut = Array.from({ length: 30 }, (_, i) =>
  `commit ${i.toString(16).padStart(7, "0")}abcdef\nAuthor: Dev <dev@example.com>\nDate:   Mon Jan ${1 + (i % 28)} 2026\n\n    Subject line ${i}\n\n    body padding dropped\n\n 1 file changed, 1 insertion(+)`).join("\n\n");
const buildOut = Array.from({ length: 200 }, (_, i) =>
  i % 5 === 0 ? `npm error code E${i}` : i % 5 === 1 ? `npm warn deprecated pkg${i}@1.0.0` :
  i % 5 === 2 ? `    Compiling foo v0.${i}.0` : i % 5 === 3 ? `warning: unused variable \`v${i}\`` :
  `    Finished dev [unoptimized] target(s) in 0.${i}s`).join("\n");
const gitDiffOut = Array.from({ length: 25 }, (_, i) =>
  `diff --git a/src/mod${i}.js b/src/mod${i}.js\nindex 1111111..2222222 100644\n--- a/src/mod${i}.js\n+++ b/src/mod${i}.js\n@@ -1,6 +1,7 @@\n ctx\n-old${i}\n+new${i}\n ctx2`).join("\n");
const lsOut = `total 48\ndrwxr-xr-x  5 jars jars  4096 Jan  5 10:00 src\n-rw-r--r--  1 jars jars 12345 Jan  5 10:01 index.js\n-rw-r--r--  1 jars jars  2048 Jan  5 10:02 style.css\n-rw-r--r--  1 jars jars   512 Jan  5 10:03 util.ts\n-rw-r--r--  1 jars jars  9999 Jan  5 10:04 data.json\n-rw-r--r--  1 jars jars  4321 Jan  5 10:05 readme.md`;
const treeOut = `.\n├── src\n│   ├── app.js\n│   └── util.js\n├── package.json\n└── README.md\n\n4 directories, 5 files`;
const findOut = Array.from({ length: 60 }, (_, i) => `./dir${i % 6}/file-with-a-longer-name${i}.js`).join("\n");
const searchList = `Result of search in '/home/proj' (total 45 files):\n` +
  Array.from({ length: 45 }, (_, i) => `- ./src/sub${i % 8}/hit${i}.ts`).join("\n");
const statusOut = `On main\nOn branch main\nChanges not staged for commit:\n\tmodified:   src/app.js\n\tmodified:   src/b.js\n\nUntracked files:\n\tsrc/new1.js\n\tsrc/new2.js`;
const dedup = Array.from({ length: 300 }, (_, i) =>
  (i % 9 === 0 ? "" : "WARN: connecting to upstream proxy 127.0.0.1:20127 (retry)")).join("\n");

const cases = [];

function push(name, body) { cases.push({ name, body }); }

push("claude-grep", { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_result", content: grepOut }] }] });
push("claude-numbered", { messages: [{ role: "tool", content: [{ type: "text", text: numbered }] }] });
push("claude-error-preserved", { messages: [{ role: "assistant", content: [{ type: "tool_result", is_error: true, content: grepOut }] }] });
push("claude-small", { messages: [{ role: "assistant", content: [{ type: "tool_result", content: "tiny output" }] }] });
push("openai-tool-string", { messages: [{ role: "tool", content: gitLogOut }, { role: "user", content: "q" }] });
push("openai-tool-array", { messages: [{ role: "tool", content: [{ type: "text", text: buildOut }] }] });
push("responses-string", { input: [{ type: "function_call_output", output: gitDiffOut }] });
push("responses-array", { input: [{ type: "function_call_output", output: [{ type: "input_text", text: lsOut }] }] });
push("kiro", { conversationState: { history: [{ userInputMessage: { userInputMessageContext: { toolResults: [{ status: "success", content: [{ text: gitLogOut }] }, { status: "error", content: [{ text: grepOut }] }] } } }], currentMessage: { userInputMessage: { userInputMessageContext: { toolResults: [{ status: "success", content: [{ text: treeOut }] }] } } } } });
push("dedup-log", { messages: [{ role: "assistant", content: [{ type: "tool_result", content: dedup }] }] });
push("build-output", { messages: [{ role: "assistant", content: [{ type: "tool_result", content: buildOut }] }] });
push("git-status-shape", { messages: [{ role: "assistant", content: [{ type: "tool_result", content: statusOut }] }] });
push("find-shape", { messages: [{ role: "assistant", content: [{ type: "tool_result", content: findOut }] }] });
push("search-list-shape", { messages: [{ role: "assistant", content: [{ type: "tool_result", content: searchList }] }] });
push("no-container", { foo: "bar" });
push("empty-messages", { messages: [] });

for (const c of cases) {
  const input = JSON.parse(JSON.stringify(c.body));
  const mutated = JSON.parse(JSON.stringify(c.body));
  const stats = compressMessages(mutated, true);
  const disabled = compressMessages(JSON.parse(JSON.stringify(c.body)), false);
  const fixture = {
    name: c.name,
    input,
    output: stats ? mutated : null,
    stats,
    log: formatRtkLog(stats),
    disabledStats: disabled,
  };
  writeFileSync(join(outDir, `${c.name}.json`), JSON.stringify(fixture, null, 1));
  console.log(`${c.name}: ${stats ? `${stats.bytesBefore} -> ${stats.bytesAfter} hits=${stats.hits.length}` : "null"}`);
}
console.log(`wrote ${cases.length} fixtures to ${outDir}`);
