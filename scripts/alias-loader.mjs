// Node ESM alias hooks for headless Node runs of repo code.
// Maps the repo's jsconfig aliases to real file URLs:
//   "@/..."        -> <repo>/src/...
//   "open-sse/..." -> <repo>/open-sse/...
//
// Runs via: node --import ./scripts/alias-loader.mjs scripts/<script>.mjs
//
// Pure ESM Node refuses extensionless specifiers ("@/lib/localDb") and
// directory imports ("@/models"), which this codebase uses throughout.
// Two hooks are registered as inline data: URLs (this Node build silently
// fails to arm hooks registered with a file specifier):
//
//   1. resolve — rewrites aliased specifiers to a canonical file URL,
//      appending ".js" to extensionless targets and falling back to
//      index.js for directories, the way Next.js/tsconfig aliases behave.
//      The bare specifier "node-machine-id" is intercepted and routed to
//      an inline data: module so Node never loads the UMD CJS bundle.
//   2. load    — reads repo .js/.mjs/.cjs sources itself and hands them to
//      Node explicitly marked as ESM ("module"), skipping package.json
//      type probing (the repo's package.json has no "type" field; .js
//      files are ESM under Next.js).
//
// Shared mutable state (the cached node-machine-id CJS module) lives on
// globalThis: the data-URL hook modules and generated data-URL modules are
// distinct instances, but globalThis is the one object they can share.
import { register, createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const repoRootUrl = pathToFileURL(repoRoot).href;
const nidDistPath = path.join(repoRoot, "node_modules", "node-machine-id", "dist", "index.js");
// Pre-load the CJS UMD bundle here, in the loader's own CJS scope — the
// `this` global is safe in sloppy-mode CJS.
const nidMod = createRequire(path.join(repoRoot, "package.json"))(nidDistPath);
// The data-URL hook module (hook #1) and the generated data-URL module are
// separate module instances; globalThis is the one object they share.
globalThis.__nidMod = nidMod;

// The exact module source emitted for the bare "node-machine-id" specifier.
const nidShimModule =
  "const __mod = globalThis.__nidMod;" +
  "export const machineIdSync = __mod.machineIdSync;" +
  "export const machineId = __mod.machineId;" +
  "export default __mod;";
const nidShimDataUrl = "data:text/javascript," + encodeURIComponent(nidShimModule);

register(
  "data:text/javascript," +
    encodeURIComponent(
      `
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const repoRoot = ${JSON.stringify(repoRoot)};
const nidShimDataUrl = ${JSON.stringify(nidShimDataUrl)};
export async function resolve(specifier, context, next) {
  if (specifier === "node-machine-id") {
    return { url: nidShimDataUrl, shortCircuit: true };
  }
  if (specifier.startsWith("@/") || specifier === "open-sse" || specifier.startsWith("open-sse/")) {
    const rootDir = specifier.startsWith("@/") ? "src" : "open-sse";
    const sub = specifier.startsWith("@/")
      ? specifier.slice(2)
      : (specifier === "open-sse" ? "" : specifier.slice("open-sse".length));
    const target = path.join(repoRoot, rootDir, sub);
    let u;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) u = target;
    else if (fs.existsSync(target + ".js")) u = target + ".js";
    else if (fs.existsSync(target + "/index.js")) u = target + "/index.js";
    else u = target;
    return { url: pathToFileURL(u).href, shortCircuit: true };
  }
  return next(specifier, context);
}
`
    ),
  import.meta.url
);

register(
  "data:text/javascript," +
    encodeURIComponent(
      `
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const repoRootUrl = ${JSON.stringify(repoRootUrl)};
export async function load(url, context, next) {
  // Repo .js/.mjs/.cjs sources: load ourselves as ESM (Next.js's treatment),
  // skipping Node's package-type probing (the repo has no "type" field).
  if (url.startsWith(repoRootUrl) && /\\.(js|mjs|cjs)$/.test(url)) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const format = url.endsWith(".cjs") ? "commonjs" : "module";
    return { format, source, shortCircuit: true };
  }
  return next(url, context);
}
`
    ),
  import.meta.url
);
