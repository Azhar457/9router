<div align="center">
  <img src="./images/9router-plinian.png" alt="9Router Plinian" width="100%" style="max-width:100%;height:auto"/>

  # 9Router Plinian

  **Independent fork of [9Router](https://github.com/decolua/9router)** — one AI gateway for all your coding tools, with a Red Team Toolkit, Aurora Violet UI, and payload-curation work that upstream doesn't ship.

  [![GitHub Release](https://img.shields.io/github/v/release/Azhar457/9router)](https://github.com/Azhar457/9router/releases)
  [![License](https://img.shields.io/npm/l/9router-plinian.svg)](./LICENSE)

  [⬇️ Install](#-install) • [🍴 What's forked](#-whats-forked-plinian-only) • [🔴 Red Team Toolkit](#-red-team-toolkit-authorized-testing) • [🙏 Acknowledgments](#-acknowledgments)

</div>

---

## 🔀 About this fork

This repository is **not** the original 9Router project. It is an independent fork of [`decolua/9router`](https://github.com/decolua/9router), maintained separately with its own roadmap, its own releases, and its own GitHub Releases (the npm package `9router-plinian` is deprecated — see Install).

- **Why it exists:** the upstream project moves slowly on the things this fork needs — jailbreak payload research, a curated payload registry, deeper UI theming, and a Go-based entry proxy for performance work.
- **What stays the same:** the core routing engine (40+ providers, format translation, combos, quota tracking, RTK token saver) is inherited from upstream and still credits it everywhere it matters.
- **What you should use:** the GitHub Releases install below. `npm install -g 9router-plinian` has been deprecated on the npm registry (dual-use scanner) and is frozen — it will not get you current releases. Use the GitHub tarball.

> 📜 The original README (as inherited from upstream) is preserved verbatim at [`docs/README-upstream-decolua.md`](./docs/README-upstream-decolua.md).

---

## 🍴 What's forked (Plinian only)

| Change | What it does |
| --- | --- |
| 🔴 **Red Team Toolkit** | Global Injection, external jailbreak payload registry, transparency console — see below |
| 🎨 **Aurora Violet + 5 palettes** | violet (default), sea, rose, amber, teal; header PaletteToggle; light/dark/system themes |
| 🖼️ **Image generation for custom nodes** | any `openai-compatible` node serves image models via the Text-to-Image page; `GET /v1/models/image` lists them |
| 🆓 **Free-tier auto-combo** | `POST /api/combos/free-tier` finds and races free models, keeps the winner per capability family |
| 📥 **Import from /models + Test All / Disable All Failed** | bulk-import a gateway's whole catalog, then mass-test or mass-disable in one click |
| ⚡ **Go entry proxy** | public port served by a Go reverse proxy (client-IP stamping, TTFB logging, RTK sidecar) |

Everything upstream ships and we don't touch — OAuth providers, combos, quota tracking, cloud sync, usage analytics — behaves as documented upstream.

---

## ⬇️ Install

**GitHub Releases is the only supported install path.** The `9router-plinian` npm package is deprecated (frozen at `0.5.94`; npm's publish-time dual-use scanner kept blocking the Red-Team payload content). Install straight from this repo's releases instead:

### Option 1 — GitHub Releases tarball (primary)

**Linux / macOS:**
```bash
curl -fsSL https://github.com/Azhar457/9router/releases/latest/download/9router-plinian-latest.tgz \
  -o /tmp/9router-plinian.tgz && npm install -g /tmp/9router-plinian.tgz
9router-plinian

**Windows (PowerShell / Command Prompt):**
> *Tips: Jika `npm` di PowerShell terhalang aturan ExecutionPolicy, Anda cukup buka **cmd.exe** (Command Prompt) biasa lalu jalankan perintah di bawah ini tanpa gangguan policy:*

```powershell
curl.exe -fsSL https://github.com/Azhar457/9router/releases/latest/download/9router-plinian-latest.tgz -o "$env:TEMP\9router-plinian.tgz"
npm install -g "$env:TEMP\9router-plinian.tgz"
9router-plinian
```

**If you hit problems on Windows:**

| Symptom | Fix |
|---|---|
| `npm install -g` fails with `EBUSY` / `EPERM` on a running tray binary | Close the tray app (right-click the system-tray icon → Quit) before reinstalling, then re-run `npm install -g`. |
| `curl` command not found / downloads nothing | Use `curl.exe` explicitly (Windows 10/11 ships it, but `curl.ps1` shadowing on some PS setups breaks the non-`.exe` alias). |
| PowerShell blocks `npm install` with `ExecutionPolicy` error | Run from **cmd.exe** instead of PowerShell, or: `Set-ExecutionPolicy -Scope Process Bypass` then retry. |
| Dashboard doesn't update after install (old version still running) | The tray launches the package from your Node global prefix, not wherever `npm install -g` landed. Check which prefix the tray actually uses (`npm config get prefix`) and install there explicitly: `npm install -g --prefix <that-prefix> ./9router-plinian.tgz`, then restart the tray. |
| Payload extraction warning during install | Harmless — the runtime auto-falls-back to the bundled classic payload. To fix: manually run `node "$(npm root -g)/9router-plinian/hooks/postinstall.js"` to re-trigger extraction. |

> **Verify integrity after download:**
> ```bash
> sha256sum /tmp/9router-plinian.tgz   # Linux/macOS
> Get-FileHash .\9router-plinian.tgz -Algorithm SHA256   # Windows
> ```

> 💡 **Why not npm?** `9router-plinian` ships security-research / red-team prompt payloads (dual-use content). npm's 2026-07-28 publish-time scanner + dual-use policy blocks the version at "automated review," and staged approval requires a human 2FA on every release. The GitHub release path sidesteps that entirely and is the supported install.

### Option 2 — from source

```bash
git clone https://github.com/Azhar457/9router.git
cd 9router
cp .env.example .env
npm install
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

Dashboard opens at **http://localhost:20128**.

**Connect a model in 30 seconds:** Dashboard → Providers → connect **Kiro AI** or **OpenCode Free** → point your tool at `http://localhost:20128/v1` with the API key from the dashboard.

Common flags:

```bash
9router-plinian --port 8080    # custom port
9router-plinian --no-browser   # don't auto-open the dashboard
9router-plinian --help         # all options
```

---

## 🔄 How it works

```
Claude Code / Codex / Cursor / Cline / OpenClaw ...
        │  http://localhost:20128/v1
        ↓
┌──────────────────────────────────────────────┐
│ 9Router Plinian (Go entry → Next.js core)   │
│  • RTK Token Saver (compress tool outputs)   │
│  • Format translation (OpenAI ↔ Claude ↔…)   │
│  • Combo + multi-account fallback            │
│  • Quota tracking, optional injections       │
└──────┬───────────────────────────────────────┘
       ├─ Subscription tier  (Claude, Codex, Copilot)
       ├─ Cheap tier         (GLM, MiniMax)
       └─ Free tier          (Kiro, OpenCode Free, Vertex)
```

One endpoint in, every tool and every provider out. Full architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 🔴 Red Team Toolkit (authorized testing)

Fork-only feature set for red-team / security-research workflows:

- **Global Injection** — one master toggle drives a register prompt + payload into the same system message (payload appended last, closest to the user query). Levels, identity, and custom payload configurable; legacy settings keys still honored.
- **External jailbreak payload registry** — file-based payload variants ingested from sibling `AI-Jailbreaks/` + `BlackFriday-GPTs-Prompts/` collections (NYX V4, Cronus, Bladwin 67, Opus 4.8, GPT 5.6, GLM RAGE, DAN, Dev Mode, …). Selection is explicit: the chosen variant is exactly what ships (no per-model auto-routing). Fail-open: missing file → classic payload.
  - `9ROUTER_JAILBREAK_DIR=/path/to/collections` — override collection dir
  - `9ROUTER_JAILBREAK_DISABLE=1` — disable the registry
- **Transparency console** — signature rules detect injections (`G0DM0D3`, `VEIL`, Plinian register, collection markers); the developer console renders register + payload in live injection order.
- **Token-saver guardrail** — active payloads skip headroom compression (no third-party leak) and skip terseness prompts (no dilution).


> ⚠️ Use only on systems you are authorized to test.

## 💰 Token Saver — and why jailbreaks change the math

The RTK token saver compresses the *repetitive* part of your session (tool
results, bulky image context) — that's what actually saves tokens. The jailbreak
payload from the Red Team Toolkit is the *opposite*: it's appended to the
system message **on every request**, so it is pure additive cost.

### The caching story (this is the part that makes or breaks you)

The gateway anchors Claude's prompt-cache breakpoints on the **final request
body** (`anchorClaudeCache`), and the injection is applied **before** that
anchor — which is deliberate and the right order:

1. The jailbreak text lives inside the cached system prefix, not in the live
   conversation. A stable payload + stable cache key means the first request
   pays a **cache-creation** write, and every subsequent request in the same
   session only pays **cache-read** tokens.
2. Cache reads are **~10× cheaper** than fresh uncached input (Anthropic:
   read = 0.1× the input rate; write = 1.25×). So the steady-state cost of a
   ~2k-token payload is ≈ 200 cache-read tokens, not 2000.

**But** the payload must stay **byte-stable** for the cache to hit. Any change
to the system prefix — swapping `godmodeLevel`, toggling the carrier, editing
the custom register text, or letting a saver reshape the system message —
**invalidates the whole prefix** and you pay a full uncached rewrite. The README's "estimate ≈ N
tok" number (`estimateGlobalInjection`) is the *steady-state uncached* figure;
the real billed cost is much lower **if** the cache holds.

### What the dashboard already tracks

`usageTracking` records `cache_read_input_tokens` / `cache_creation_input_tokens`
per request (Claude + Kiro native fields, OpenAI `prompt_tokens_details.cached_tokens`,
Gemini `prompt_cache_hit_tokens`). Pricing already discounts cache-read and
cache-creation at their own rates, so the usage/cost reports show the true
blended number — you don't have to do this by hand.

### Practical levers (in order of impact)

| Lever | Effect |
| --- | --- |
| Keep one `godmodeLevel` + one carrier **fixed** per provider/account | cache hits every turn; payload amortizes to ~0.1× |
| Use **5m** TTL for short sessions, **1h** for long ones (`cache_control` `ttl`) | long idle gaps stop double-billing the write |
| **Don't toggle the injection mid-session** to "save" — that's the biggest single invalidator | one rewrite costs more than the payload it's trying to avoid |
| Turn the payload **off entirely** for the boring tasks (plain chat, coding, tool loops that don't need it) | zero additive cost on the requests that don't need it |
| Enable **RTK compression** alongside the payload for tool-heavy sessions | the tool-result savings usually dwarf the payload cost |

**Net effect:** for a typical payload-heavy session, the RTK savings on
tool/output tokens **outweigh** the injected-payload overhead by an order of
magnitude — as long as the cache isn't invalidated. The thing to *avoid* is
flapping the injection settings; that's where the real money leaks.

### Reading your own numbers

In the gateway log, the `DONE` line for each request carries a `CACHE`
breakdown — `↻N` = cache-read tokens, `+N` = cache-write (creation) tokens:

```
#1  DONE 1820ms · IN 4210 (CACHE +2100) · OUT 380   ← first turn: pay the write
#2  DONE  940ms · IN 4210 (CACHE ↻2100) · OUT 250   ← next turn: read at 0.1×
#3  DONE 1010ms · IN 4210 (CACHE ↻2100) · OUT 410   ← …and every turn after
```

The **`cache_create` row is the one-time setup cost** — after that, the
payload is essentially free (a read at 0.1× the input rate). The single way
to lose it is to change the injection configuration mid-session; that row
shows up again as a new `cache_create` and you've paid the full rewrite.

### GLM-5.1 / GLM-4.7 (Daily reset, $0.6/1M)

1. Sign up: [Zhipu AI](https://open.bigmodel.cn/)
2. Get API key from Coding Plan
3. Dashboard → Add API Key:
   - Provider: `glm`
   - API Key: `your-key`

**Use:** `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`

**Pro Tip:** Coding Plan offers 3× quota at 1/7 cost! Reset daily 10:00 AM.

### MiniMax M2.7 (5h reset, $0.20/1M)

1. Sign up: [MiniMax](https://www.minimax.io/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`

**Pro Tip:** Cheapest option for long context (1M tokens)!

### Kimi K2.5 ($9/month flat)

1. Subscribe: [Moonshot AI](https://platform.moonshot.ai/)
2. Get API key
3. Dashboard → Add API Key

**Use:** `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`

**Pro Tip:** Fixed $9/month for 10M tokens = $0.90/1M effective cost!

</details>

<details>
<summary><b>🆓 FREE Providers (Recommended)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax FREE)

```bash
Dashboard → Connect Kiro
→ AWS Builder ID, AWS IAM Identity Center, Google, or GitHub
→ Unlimited usage

Models:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**Pro Tip:** Best free option for Claude. No API key, no payment, fully unlimited.

### OpenCode Free (No auth, auto-fetch models)

```bash
Dashboard → Connect OpenCode Free
→ No login required (passthrough proxy)
→ Models auto-fetched from opencode.ai/zen/v1/models
```

**Pro Tip:** Fastest setup. Just connect and start coding.

### Vertex AI ($300 free credits for new GCP accounts)

```bash
Dashboard → Connect Vertex AI
→ Upload Google Cloud Service Account JSON
→ Enable Vertex AI API in your GCP project

Models:
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex Partner (Anthropic / DeepSeek / GLM / Qwen via Vertex):
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

For a raw Google Cloud API-key connection, set the following through
`PUT /api/providers/<connection-id>` to select the global endpoint:

```json
{
  "providerSpecificData": {
    "projectId": "YOUR_GOOGLE_CLOUD_PROJECT_ID",
    "location": "global"
  }
}
```

With an explicit project, API-key requests honor `location` and default to
`global` when it is omitted. Connections without an explicit project retain
the projectless endpoint. Gemini 4 Argon supports `global`, `us`, and `eu`,
not regional locations such as `europe-west1`; see
[Google's supported locations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-argon).

**Pro Tip:** New Google Cloud accounts get $300 credits free for 90 days. Plenty for daily coding.

</details>

<details>
<summary><b>🎨 Create Combos</b></summary>

### Example 1: Maximize Subscription → Cheap Backup

---


## 💾 Data location

| Platform | Path |
| --- | --- |
| macOS / Linux | `~/.9router/db/data.sqlite` |
| Windows | `%APPDATA%\9router\db\data.sqlite` |
| Custom | set `DATA_DIR` (e.g. Docker volume mount) |

Security-relevant env (full contract in `.env.example`): `JWT_SECRET`, `INITIAL_PASSWORD` (default `123456` — **override it**), `API_KEY_SECRET`, `MACHINE_ID_SALT`.

---

## 📖 Documentation

- **This fork:** [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`CHANGELOG.md`](./CHANGELOG.md) · issues in this repo
- **Upstream project:** [github.com/decolua/9router](https://github.com/decolua/9router) — original docs, video tutorials, and the full translated README set (`i18n/README.*.md`)

---

## 🙏 Acknowledgments

This fork stands on a lot of other people's work:

- **[decolua](https://github.com/decolua)** and every contributor to **[9Router](https://github.com/decolua/9router)** — the original project this repo is forked from: the router, the dashboard, the provider registry, the docs.
- **[CLIProxyAPI](https://github.com/1rgs/CLIProxyAPI)** — original Go implementation 9Router was built on.
- **[RTK](https://github.com/rtk-ai/rtk)** (token saver), **[Headroom](https://github.com/chopratejas/headroom)** (compression proxy), **[Caveman](https://github.com/JuliusBrussee/caveman)** and **[Ponytail](https://github.com/DietrichGebert/ponytail)** (prompt modes) — integrated token-saving tools, each linked to its own project.
- The **AI-Jailbreaks** and **BlackFriday-GPTs-Prompts** collection authors — payload source material for the Red Team Toolkit.
- Every creator who made a 9Router video tutorial — the community setup guides live on [upstream's README](https://github.com/decolua/9router#-video-guides).

If you're looking for the original project, go to **[decolua/9router](https://github.com/decolua/9router)** — don't confuse the two. This is a fork, plainly labeled as one.

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
