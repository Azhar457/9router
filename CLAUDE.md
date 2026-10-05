# CLAUDE.md

## Direction & current focus (2026-10)

Read this first — it overrides default priorities:

- **Dashboard transparency must be live, never decorative**: any status indicator (header Shield, model pickers, payload state) MUST read live state — fetch on mount AND on `SETTINGS_CHANGED_EVENT`, window focus, and tab visibility. An indicator that only shows its mount-time snapshot is a bug. `src/shared/lib/settingsSync.js` wraps `fetch` so every successful `/api/settings` PATCH broadcasts automatically; `src/shared/hooks/usePayloadStatus.js` is the reference hook. Don't hand-roll the dispatch at each call site.
- **Three independent surfaces, never merged**: Jailbreak payloads (Payload tab), Strix skill-router (Penetration tab), and benchmarking (Developer tab). `injectionGodmodeCustom` (jailbreak) and `injectionSkillRouterCustom` (skill-router) are separate settings slots appended as separate blocks by `injectGlobal()` — one surface must never write the other's slot.
- **Go migration**: the entry layer is already Go (`go/` reverse proxy owns the public port — client-IP stamping, TTFB log, RTK sidecar; `RTK_BACKEND=go`). App logic stays in Next.js for now. Direction: move more of the hot request path (v1 lane, executors, translators) into Go; keep the Next dashboard. New performance-sensitive work SHOULD land behind the Go proxy where it fits, not in new JS hot paths.
- **Jailbreak payload curation**: active work — sorting `AI-Jailbreaks/` + `BlackFriday-GPTs-Prompts/` payloads by validity per model family (which payloads actually land on which model, model-aware routing in `open-sse/rtk/godmodePayloads.js` `MODEL_VARIANT_MAP`). Payload files are the asset being curated; treat payload effectiveness data as first-class when touching them.
- **Token-cost visibility**: steering/jailbreak payloads are expensive (8KB–70KB). Estimates surface via `open-sse/rtk/tokenEstimate.js` (aggregate ≈ chars/4, marked "est" — tokenizers differ per model, so per-payload numbers are approximate). New payload/steering features MUST surface their token cost, not just char count. Anything that would ship a large blob on every request should instead ship a small pointer and let the consumer fetch the bulk on demand — see `buildStrixSkillRouterPointer()` in `open-sse/rtk/strixSkillRouter.js`.
- **Routable-model correctness**: `/v1/models` must never advertise models a user can't reach. Switching a provider off (`isActive === false`) drops that provider's models AND any combo whose members are all unreachable. Dashboard model pickers derive from `/v1/models`, so this endpoint is the single source of truth for "which models exist right now".

## What this is

9Router-Plinian (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, quota/usage tracking, and optional cloud sync.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (Next.js app + dashboard/compat APIs), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package), and `tests/`.

## Repo hygiene — local-only scaffolding (do not commit, do not ship)

These folders are local development scaffolding: no `src/` or `open-sse/` file imports them, no GitHub workflow runs them, and the Docker build never copies them. All are ignored in `.gitignore`:

| Folder | Contents | Keep? |
|--------|----------|-------|
| `benchmarks/` | perf baselines (api-latency, bundle-size, memory, lighthouse) + measure scripts | local only |
| `uat/` | manual UAT protocol, scorecard, checklists | local only |
| `payload-regression/` | payload composition regression reports + verdict JSON | local only |
| `test/` | ad-hoc node self-check scripts (e.g. cline resolver narrowing) | local only |
| `tests/` | the real vitest suite | **KEEP — regression gate** |

If one of these is missing locally, it is disposable — regenerate or recreate as needed. Never wire any of them into `src/`, `open-sse/`, `.github/workflows/`, or the Dockerfile. `tests/node_modules/` (~40MB, hosts the vitest runner) is gitignored and restored with `cd tests && npm install`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev   # dev (webpack, port 20127 by default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start           # production
```
- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `npx eslint .` (config `eslint.config.mjs`, extends `eslint-config-next`).

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Tests (vitest, in `tests/`, an **independent** ESM package — not wired into root `npm test`):
```bash
npm install                             # ROOT deps first — tests import from src/ which needs `open`, `undici`, etc.
cd tests && npm install                 # then tests' own deps (vitest) → tests/node_modules (allowed by tests/.gitignore)
npx vitest run                          # all tests; auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file (path relative to tests/)
```
> **Current baseline is NOT green**: ~100 tests fail on a clean checkout across
> `translator/`, `unit/xai-oauth-service`, `unit/auth*`, and `unit/golden-url-header`
> — these are pre-existing and unrelated to dashboard work. Judge regressions against
> that baseline, not against zero.
> - `unit/embeddings.cloud.test.js` imports `cloud/src/handlers/embeddings.js` — the
>   `cloud/` worker dir is **not in this repo**, so it always fails here.
> - `unit/xai-oauth-service.test.js` times out (5s) when the xAI endpoint-discovery
>   fetch isn't reachable/mocked.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
> - Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed
>   snapshots (providers, aliases, OAuth URLs). Run these after touching the provider
>   registry or alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model.
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- **Security-first on PRs**: Security is the top priority when reviewing or creating PRs. Audit authentication, credential/token storage & leaks, header manipulation (`X-Forwarded-For`), and SSRF risks before functional logic. Always include explicit security warnings/notes when reporting PR reviews or changes to the user.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
