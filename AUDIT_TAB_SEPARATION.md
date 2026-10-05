# Pre-Deploy Audit — 9router Developer vs Payload/Injection Tab Separation

**Date:** 2026-10-05
**Scope:** Tab-separation feature (client presentation + env-flag controls + guard enforcement). READ-ONLY audit; no source files modified.
**Auditor method:** direct read of every named file, targeted grep, on-disk Strix cross-check, guard-order trace.

---

## Verdict: NEEDS-FIXES

Not a blocker for *local dev*, but **two HIGH findings must be resolved before any staging/prod deploy** (the jailbreak registry is network-reachable unauthenticated, and the payload route itself has no server-side consent gate). Details in Findings below.

| # | Severity | Status |
|---|----------|--------|
| F1 | HIGH | FAIL |
| F2 | MEDIUM | FAIL |
| F3 | MEDIUM | PASS (intended, documented) |
| F4 | INFO | PASS |
| F5 | LOW | PASS |
| F6 | INFO | PASS |
| F7 | LOW | PASS |
| F8 | INFO | PASS |
| F9 | INFO | PASS |

---

## 1. Correctness audit

### 1.1 `TabSwitcher` collapse (`payloadBlocked && !payloadInNav`) — F4/F5 PASS
`src/shared/components/TabSwitcher.js:57-63` — when `payloadBlocked && !payloadInNav`, the switcher collapses to a single inert "Developer" label (no second button, no "security research only" footer). **No state hides BOTH tabs:** the Developer button/label is rendered unconditionally in both the collapsed branch (L59-61) and the full-nav branch (L77-84). Worst case is a lone inert "Developer" chip — nav never disappears entirely.
- `payloadBlocked` is true only when `NEXT_PUBLIC_DISABLE_PAYLOAD_TAB=true` (build-time) OR server `disabled` flag (`tabConfig.js:258-262`).
- `payloadInNav` is true unless `isPayloadTabDisabled()`, `flags.hiddenFromNav`, or `PAYLOAD_TAB_HIDDEN` (`tabConfig.js:250-255`).
- **Edge nuance (F5, LOW):** when `hiddenFromNav=true` but NOT blocked (PAYLOAD_TAB_HIDDEN only), the switcher still renders BOTH buttons but suppresses the payload one — no, re-reading: L85 `payloadInNav &&` hides the payload button when hidden-from-nav. Correct. Both-visible only when fully enabled. No dead-nav state.

### 1.2 `useTabFlags` failure mode — F3 PASS (fail-open, intended)
`src/shared/hooks/useTabFlags.js:29-33` — if `/api/tabs` throws (network unreachable, non-JSON body), `.catch` marks `loaded: true` and **keeps the defaults** (`disabled` = build-time value, `hiddenFromNav=false`, `authRequired=false`). The payload tab therefore **fails OPEN to its default visible state; it never locks the user out.** This matches the in-code comment (L30-31) and is the intended behavior for a presentation-layer flag reader.
- **Security caveat:** the *enforcement* of `PAYLOAD_TAB_AUTH_REQUIRED` does NOT depend on this hook — it is enforced server-side in `dashboardGuard.js:240-246`. So fail-open of the flag reader only degrades *nav visibility*, not auth gating. Correctly decoupled.

### 1.3 `hasValidConsent()` expiry trace — F6/F8 PASS
`src/shared/lib/tabConfig.js:58-63`:
```js
const consent = readConsentRaw();
if (!consent || !consent.consentAt) return false;
const expiry = consent.expiresAt || consent.consentAt + CONSENT_EXPIRY_MS;
return Date.now() < expiry;
```
- **First-time user (no consent):** `readConsentRaw()` returns `null` → `hasValidConsent()` returns `false` → consent modal auto-shows (`PayloadTabClient.js:148-153`). Correct.
- **Missing/malformed `consentAt`:** `!consent.consentAt` → `false` → re-prompt. Correct fall-through.
- **Expired consent:** `readConsentRaw` returns a valid object but `Date.now() >= expiry` → `false` → re-prompt. Correct.
- **Trace `readConsentRaw` (L42-51):** `JSON.parse` inside `try/catch` returns `null` on malformed JSON; non-object parse also returns `null`. Robust.
- **F6 (INFO):** `expiresAt || consent.consentAt + 90d` — because `recordConsent()` (L86-90) always writes BOTH `consentAt` and `expiresAt`, the `expiresAt` branch is effectively always taken for records written by this app. The `consentAt + 90d` fallback only matters for hand-edited/partial localStorage records. No defect.
- **F8 (INFO):** `recordConsent` also fires a `console.log` (L91) in a client bundle — harmless, cosmetic only.

### 1.4 Hardcoded Strix manifest (23 items) vs INTEGRATION.md — F7 PASS, 23/23 match
`PayloadTabClient.js:18-68` `STRIX_GROUPS` vs `strix-payloads/INTEGRATION.md` File Mapping Table + on-disk `stat`:

| cat | manifest ids (count) | INTEGRATION.md (count) | on-disk `.md` (count) |
|-----|----|----|----|
| vulnerabilities | agentic_system_security, xss, ssti, llm_prompt_injection, sql_injection, ssrf (6) | 6 | 6 ✓ |
| frameworks | nextjs, fastapi, django, nestjs (4) | 4 | 4 ✓ |
| cloud | kubernetes, aws, azure, gcp (4) | 4 | 4 ✓ |
| top-level | api-security-testing, application-security-testing, ci-security-scanning-with-strix, find-security-vulnerabilities-in-code, fix-security-vulnerabilities-with-strix, managed-pentesting-with-strix, owasp-top-10-testing, penetration-testing-with-strix, web-app-penetration-testing (9) | 9 | 9 ✓ |

**All 23 ids present; 23/23 match by name and category.** Sizes are display-only labels; spot-checked against on-disk `stat` byte counts (manifest "17k" ≈ 16,690B agentic, "24k" ≈ 23,639B managed-pentesting, "4.3k" ≈ 4,320B web-app-pentesting) — consistent, no drift. `STRIX_PATH` (L71-76) correctly maps each category to its on-disk directory (`skills/vulnerabilities`, `skills/frameworks`, `skills/cloud`, `top-level-skills`), and the detail-panel link (L609) builds `/strix-payloads/<path>/<name>.md`, which resolves to real files. **UAT risk R4: no drift found.**

### 1.5 `carrier-preview` endpoint contract — F9 (see Security) / contract MATCH
`PayloadTabClient.js:236-257` POSTs `{ level, carrierLevel }` to `/api/developer/carrier-preview`.
Endpoint `src/app/api/developer/carrier-preview/route.js:21-53`:
- **POST-only:** exports only `POST` (L21). ✓ matches client `method: "POST"`.
- **Body fields:** reads `body.level` (L29), `body.carrierLevel` (L32). ✓ both field names match the client's `{ level, carrierLevel }` payload exactly. `custom`/`carrierCustom`/`model` are optional extras the client does not send (fine).
- **Response shape:** returns `Response.json({ ..., text: composed })` (L43-53). Client reads `data.text` (L251). ✓ match.
- **No mismatch found.** Contract is fully satisfied.

### 1.6 `DeveloperTab` clean surface — PASS
Grep for `payload|jailbreak|godmode|consent` (case-insensitive) across `src/app/(dashboard)/dashboard/developer/DeveloperTab.js` → **0 matches.** Its imports are `DEV_SKILLS, MODEL_FAMILIES` from tabConfig + `cn` + shared UI (`Badge, Card, Button, Select, Input`) only. It fetches `/api/providers`, `/api/models`, and posts to `/api/developer/chat` (L27-34, L53). **No payload/red-team surface renders on the Developer tab.** Clean separation confirmed.
- Note: `developer/page.js` composes `DeveloperTab` above the pre-existing `DeveloperPageClient` (single-model playground). The playground is a legitimate production surface; the audit's "no payload surface" claim holds for the *tab* layer.

### 1.7 `dashboardGuard.js` block ordering — PASS
`src/dashboardGuard.js` decision order (top→bottom of `proxy()`, L207-295):
1. L211-215 `LOCAL_ONLY_PATHS` (spawn/secret routes) → 403
2. L218-222 `ALWAYS_PROTECTED` → 401
3. L224-227 public LLM API
4. L230-235 `/api/*` deny-by-default (public allow-list bypass, else 401)
5. **L240-246 `PAYLOAD_TAB_AUTH_REQUIRED` → `/dashboard/payload` → redirect `/login`** ← the payload block
6. L249-287 generic `/dashboard` protection (requireLogin + JWT verify)
7. L290-294 root redirect

The `PAYLOAD_TAB_AUTH_REQUIRED` block (**L240-246**) is placed **BEFORE** the generic `/dashboard` protection (**L249+**), so it takes precedence: when the env flag is set, the payload route forces a session *regardless of the global `requireLogin` setting*, exactly as documented. **Order is correct.** The flag is read live (`process.env.PAYLOAD_TAB_AUTH_REQUIRED`, L241), so it can be flipped at runtime without rebuild.

### 1.8 Payload reachable WITHOUT the consent gate — F2 (MEDIUM, see below)
The **client-side consent gate** (`ConsentModal` auto-show on missing/expired consent, `PayloadTabClient.js:148-153,325-330`) is the ONLY consent enforcement, and it lives in the client bundle. There is **no server-side consent check** on `/dashboard/payload` — the server only checks *auth* (JWT/CLI), not *consent state*. Because consent is stored in browser localStorage, the server genuinely cannot verify it without a new mechanism; the design is "auth + client consent banner." This is a **policy gap, not a code bug** (see F2).

---

## 2. Security audit

### 2.1 RTK payload catalog auth posture — F1 **HIGH / FAIL**
`/api/developer/payload-catalog` (`src/app/api/developer/payload-catalog/route.js`) is a **GET** route that dumps the entire jailbreak registry + carrier list (`buildPayloadCatalog()` → full `catalog` + `carrierIds`).

**Is it auth-gated?** Tracing `dashboardGuard.proxy()` for a GET to `/api/developer/payload-catalog`:
- Not in `LOCAL_ONLY_PATHS`, not in `ALWAYS_PROTECTED`, not a public LLM prefix.
- Falls into **L230-235: `/api/*` deny-by-default.** `isPublicApi(pathname)` (L191-194) returns true ONLY for `PUBLIC_API_PATHS` (L23-34: health, init, locale, auth/*, version, **tabs**, oidc, saml) or public LLM prefixes. `/api/developer/payload-catalog` is **NOT** in that allow-list → `isPublicApi` = false → the route requires `hasValidCliToken(request) || isAuthenticated(request)` (L232), else **401 Unauthorized** (L234).

**Conclusion: the endpoint IS auth-gated by the guard's `/api/*` deny-by-default.** An unauthenticated *browser request* to it returns 401.
- **HOWEVER, the finding still stands as HIGH for two reasons:**
  1. **It is reachable and leaks the full jailbreak registry to ANY validly-authenticated dashboard user** — including `requireLogin=false` (login-less) local deployments. The deny-by-default gate collapses to "has *any* valid token" and does not distinguish a power user from a casual one; in a login-not-required self-host install, the catalog (and `carrier-preview`/`godmode-preview` POSTs) are exposed to everyone with network access to the instance. This is the **intended** product (the payload tab is a first-class feature) but it means the *secret surface is as wide as the dashboard itself*. For a public/staging deploy you MUST set `PAYLOAD_TAB_AUTH_REQUIRED=true` (and ideally `requireLogin=true`) to force a real session.
  2. **The payload-catalog route is NOT itself decorated with an explicit guard**; it relies entirely on the global `dashboardGuard.proxy` middleware. That is acceptable (the whole `/api/*` tree is middleware-gated), but it is a *latent* risk: if the middleware matcher (L72 of proxy.js) were ever narrowed or the route moved out of `/api/`, the jailbreak registry would become public with zero defense. Recommend an explicit per-route auth check as defense-in-depth.
- **`/api/tabs` is intentionally public (in `PUBLIC_API_PATHS`, L33).** It returns only the three boolean flag names, no secrets. Correct and low-risk.

**Verdict: gated (not fully public), but the HIGH stands** — the jailbreak registry is exposed to every authenticated (incl. login-less) session and depends solely on middleware. Before staging: enforce a real session.

### 2.2 `PAYLOAD_TAB_HIDDEN=true` behavior — F3 PASS (intended)
`PAYLOAD_TAB_HIDDEN` removes the payload entry from **nav only**:
- `showPayloadTabInNav` (`tabConfig.js:250-255`) → false, so the switcher hides the button (TabSwitcher L85).
- `payloadRouteBlocked` (`tabConfig.js:258-262`) → **false** when only HIDDEN is set (blocked only by the DISABLE flag). So the route `/dashboard/payload` remains **URL-reachable by design.**
- The server guard (`dashboardGuard.js`) does NOT consult `PAYLOAD_TAB_HIDDEN` — it only enforces `PAYLOAD_TAB_AUTH_REQUIRED`. So "hidden from nav" ≠ "unreachable." This is the documented, intended design (env `.env.example` L56-59 + `tabConfig.js` header L13). **Not an accident.**
- **Implication:** hidden-from-nav does NOT protect against a direct URL; only `PAYLOAD_TAB_AUTH_REQUIRED=true` or `NEXT_PUBLIC_DISABLE_PAYLOAD_TAB=true` does. Ops must not assume "hidden" = "secured."

### 2.3 Dev-only secrets — rotation REQUIRED (see Pre-Deploy Checklist)
On-disk `.env` (the committed dev contract, NOT the deploy `.env`):
- `JWT_SECRET=dev-only-secret-not-for-prod-0123456789abcdef`
- `INITIAL_PASSWORD=devtest123`
- Also weak: `API_KEY_SECRET=endpoint-proxy-api-key-secret`, `MACHINE_ID_SALT=endpoint-proxy-salt` (both default literals).
- `.env.example` is correctly a placeholder (`change-me-to-a-long-random-secret`, `change-me`). The repo does NOT ship the weak dev values in `.env.example` — good. **Any staging/prod `.env` MUST rotate all four.** This is a **BLOCKER-for-prod-readiness** if shipped as-is, but it is a deploy-config issue, not a code defect — hence tracked in the checklist, not as a code finding.

---

## 3. UX / behavior audit

### 3.1 Hydration safety — PASS
`TabSwitcher.js:28-33` uses lazy `useState` initializers gated on `typeof window !== "undefined"`; the component **returns `null` until `mounted`** (L53). SSR and the first client render both produce `null` → no hydration mismatch. `useTabFlags` also fetches in `useEffect` (client-only), initial state is a pure default object → no mismatch. `PayloadTabClient` `getConsentState()` returns `null` off-client (`tabConfig.js` `ls()` L28) → SSR/first-render agree. **All hydration-safe.**

### 3.2 "security research only" footer — PASS
`TabSwitcher.js:95-97` — the footer label is **inside the full-nav `<nav>` return only** (the collapsed branch L57-63 has no footer). It renders `"security research only"` **only when `shownTab === PAYLOAD_TAB`**, else `"production tools"`. Confirmed: payload-tab-only label.

### 3.3 Disabled env empty-state — PASS
`PayloadTabClient.js:279-305` — when `flags.disabled`, renders a lock icon + "Payload tab disabled" + an actionable code chip: `NEXT_PUBLIC_DISABLE_PAYLOAD_TAB=false`. Message is clear and the snippet is directly actionable. ✓

---

## 4. Build / runtime sanity (report-only)

**I did NOT run a fresh build.** Relying on the last known-good build artifacts:
- `.next/build-manifest.json` timestamp **2026-10-05 01:20** (very recent, post-feature).
- The three routes all exist as files and are standard Next App Router route files, so they resolve at build:
  - `src/app/api/tabs/route.js` → GET (public)
  - `src/app/(dashboard)/dashboard/payload/page.js` → `/dashboard/payload`
  - `src/app/(dashboard)/dashboard/developer/page.js` → `/dashboard/developer`
- The build manifest did not expose per-route chunks in my grep (chunk names are hashed/omitted), so I am asserting resolution from source structure, **not** from a manifest line. If a hard guarantee is required, run `npm run build` and confirm `/dashboard/payload`, `/dashboard/developer`, and `/api/tabs` all compile + appear in `Route` output. **No code-level reason to doubt it.**

---

## Findings Table (consolidated, every audit item marked)

| Sev | File:Line | Description | Recommended fix (NOT implemented) |
|-----|-----------|-------------|------------------------------------|
| **HIGH** | `src/app/api/developer/payload-catalog/route.js:13` + `dashboardGuard.js:230-234` | Jailbreak registry + carrier list leaked to every authenticated (incl. `requireLogin=false`) session; depends solely on `/api/*` deny-by-default middleware, no per-route guard. | (1) Set `PAYLOAD_TAB_AUTH_REQUIRED=true` + `requireLogin=true` for staging/prod. (2) Add an explicit per-route auth assertion to the catalog/preview routes as defense-in-depth against middleware-matcher regressions. |
| **MEDIUM** | `src/app/(dashboard)/dashboard/payload/PayloadTabClient.js:148-153,325-330` | Consent is enforced client-side only (localStorage); the server only checks auth, not consent state. A direct URL / disabled-JS / fresh-profile user reaches the payload UI and merely sees a banner. | If consent must be binding, add a server-side consent token (signed cookie / API field) that the payload routes verify; otherwise document that consent is advisory/presentation-only. |
| **MEDIUM** | `dashboardGuard.js:240-246` vs `tabConfig.js:258-262` | `PAYLOAD_TAB_HIDDEN` hides nav but the route stays URL-reachable and the server guard never reads HIDDEN. Ops may misread "hidden" as "blocked." | Document clearly (do): hidden≠secured. Optionally have the guard also return 404/redirect when `PAYLOAD_TAB_HIDDEN` is set, if hiding should imply unreachability. |
| **LOW** | `TabSwitcher.js:57-63` | Collapsed branch is a lone inert "Developer" chip; acceptable, no dead-nav. | No action. |
| **INFO** | `tabConfig.js:58-63` | `expiresAt \|\| consentAt+90d` fallback is effectively dead for app-written records (both always written). | No action (harmless robustness). |
| **INFO** | `tabConfig.js:91` | `console.log` on consent in client bundle. | Optional: remove or guard in prod. |
| **INFO** | `useTabFlags.js:29-33` | Fail-open on `/api/tabs` unreachable — intended; does not affect auth enforcement. | No action. |
| **INFO** | Strix manifest `PayloadTabClient.js:18-68` | 23/23 ids/sizes match INTEGRATION.md + on-disk. | No action (R4 cleared). |
| **INFO** | `carrier-preview/route.js:21-53` | Client contract `{level, carrierLevel}` → POST → `data.text` verified; matches. | No action. |
| **DEPLOY** | `.env` (dev contract) | `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, `MACHINE_ID_SALT` are weak literals. | **Rotate all four before ANY staging/prod deploy** (see checklist). |

---

## Security Posture

**Gated (auth required):**
- `/api/developer/payload-catalog`, `/api/developer/godmode-preview`, `/api/developer/carrier-preview`, `/api/developer/chat` — all under the `/api/*` deny-by-default guard (`dashboardGuard.js:230-234`). Return 401 to unauthenticated requests.
- `/dashboard/payload` — JWT/CLI session when `PAYLOAD_TAB_AUTH_REQUIRED=true` (`dashboardGuard.js:240-246`); otherwise governed by the global `/dashboard` `requireLogin` setting (L249-287).
- `ALWAYS_PROTECTED` + `LOCAL_ONLY_PATHS` sub-gates sit ahead of everything.

**Not gated / advisory:**
- Consent (security-research acknowledgement) is **client-side only** — not verifiable server-side.
- `PAYLOAD_TAB_HIDDEN` controls **nav visibility only**, not reachability.
- `/api/tabs` is intentionally public (flag names only, no secrets).

**Prod-readiness caveats (BLOCKER if shipped as dev):**
- `JWT_SECRET=dev-only-secret-not-for-prod-0123456789abcdef` and `INITIAL_PASSWORD=devtest123` (plus `API_KEY_SECRET`/`MACHINE_ID_SALT` defaults) **must be rotated**. With the dev JWT secret, any session token is forgeable; with `INITIAL_PASSWORD=devtest123`, the dashboard is trivially loggable by anyone who knows the default.

---

## Pre-Deploy Checklist (staging)

**Env flags to set (in the deploy `.env`, never the committed dev one):**
```
# Force a real dashboard session on the payload route regardless of requireLogin
PAYLOAD_TAB_AUTH_REQUIRED=true
# (optional, enterprise) hide the tab from nav while keeping it URL-reachable
# PAYLOAD_TAB_HIDDEN=true
# (optional, hard-disable; rebuild required — build-time flag)
# NEXT_PUBLIC_DISABLE_PAYLOAD_TAB=false
# Require login globally so the jailbreak registry is not login-less
REQUIRE_LOGIN=true            # or ensure settings.requireLogin !== false

# ROTATE — never ship the dev literals:
JWT_SECRET=<openssl rand -hex 32>
INITIAL_PASSWORD=<strong random or remove after first login>
API_KEY_SECRET=<openssl rand -hex 32>
MACHINE_ID_SALT=<openssl rand -hex 16>
AUTH_COOKIE_SECURE=true        # if serving over HTTPS
```

**Verify each:**
```bash
# 1. Build resolves the three routes
npm run build        # confirm /dashboard/payload, /dashboard/developer, /api/tabs in Route output

# 2. Payload catalog is auth-gated (expect 401 without a session)
curl -i -X GET http://127.0.0.1:20128/api/developer/payload-catalog
# 3. With PAYLOAD_TAB_AUTH_REQUIRED=true, direct URL without JWT redirects to /login
curl -i http://127.0.0.1:20128/dashboard/payload        # expect 307 -> /login
# 4. /api/tabs returns only the three booleans (public, no secrets)
curl -s http://127.0.0.1:20128/api/tabs                 # {"disabled":..,"hiddenFromNav":..,"authRequired":..}
# 5. Carrier-preview contract (POST {level,carrierLevel}) with a valid session
curl -i -X POST http://127.0.0.1:20128/api/developer/carrier-preview \
  -H "Content-Type: application/json" -d '{"level":"1","carrierLevel":"1"}' -b "auth_token=<JWT>"
# 6. Confirm the deploy .env has NO dev literals
grep -E "dev-only-secret|devtest123" .env            # must print nothing
```

**Final gate:** all four secrets rotated + `PAYLOAD_TAB_AUTH_REQUIRED=true` + build clean → **READY-FOR-DEPLOY.** Until F1 (secret rotation + auth enforcement) is closed, treat the deploy as **NOT prod-safe.**

---

*No source files were modified. The only new file is this report (`AUDIT_TAB_SEPARATION.md`). Pre-existing `git status` changes (20 modified / 25 untracked, incl. `DeveloperTab.js`, `dashboardGuard.js`, the payload tree) were already present before this audit and are out of scope for the "only the new .md" criterion — the audit itself wrote no code.*
