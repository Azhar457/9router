<div align="center">
  <img src="./images/9router.png?1" alt="9Router Plinian" width="800"/>

  # 9Router Plinian

  **Independent fork of [9Router](https://github.com/decolua/9router)** — one AI gateway for all your coding tools, with a Red Team Toolkit, Aurora Violet UI, and payload-curation work that upstream doesn't ship.

  [![npm](https://img.shields.io/npm/v/9router-plinian.svg)](https://www.npmjs.com/package/9router-plinian)
  [![GitHub Release](https://img.shields.io/github/v/release/Azhar457/9router)](https://github.com/Azhar457/9router/releases)
  [![License](https://img.shields.io/npm/l/9router-plinian.svg)](./LICENSE)

  [⬇️ Install](#-install) • [🍴 What's forked](#-whats-forked-plinian-only) • [🔴 Red Team Toolkit](#-red-team-toolkit-authorized-testing) • [🙏 Acknowledgments](#-acknowledgments)

</div>

---

## 🔀 About this fork

This repository is **not** the original 9Router project. It is an independent fork of [`decolua/9router`](https://github.com/decolua/9router), maintained separately with its own roadmap, its own releases, and its own npm package (`9router-plinian`).

- **Why it exists:** the upstream project moves slowly on the things this fork needs — jailbreak payload research, model-aware payload routing, deeper UI theming, and a Go-based entry proxy for performance work.
- **What stays the same:** the core routing engine (40+ providers, format translation, combos, quota tracking, RTK token saver) is inherited from upstream and still credits it everywhere it matters.
- **What you should use:** `npm install -g 9router-plinian` installs *this* fork. Installing upstream's `9router` package gets you their build, not ours.

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

**GitHub Releases is the only install path.** `9router-plinian` is not published to the npm registry — the Red-Team payload collections ship as a bundled archive (ETL), and npm's publish-time dual-use scanner has repeatedly blocked the red-team content. Install straight from this repo's releases instead:

```bash
curl -fsSL https://github.com/Azhar457/9router/releases/latest/download/9router-plinian-latest.tgz -o /tmp/9router-plinian.tgz
npm install -g /tmp/9router-plinian.tgz
9router-plinian
```

PowerShell:

```powershell
curl.exe -fsSL https://github.com/Azhar457/9router/releases/latest/download/9router-plinian-latest.tgz -o $env:TEMP\9router-plinian.tgz
npm install -g $env:TEMP\9router-plinian.tgz
9router-plinian
```

> `npm install -g <file>` still resolves the package's few small dependencies (react, node-forge, …) from whatever registry your npm is configured to use — a mirror counts. Only the package itself is fetched from GitHub. The Red-Team payloads load at install time from the bundled `payloads.tar.gz` into `~/.9router/payloads/` (override with `9ROUTER_JAILBREAK_DIR`).

> 💡 **Why not npm?** `9router-plinian` ships security-research / red-team prompt payloads (dual-use content). npm's 2026-07-28 publish-time scanner + dual-use policy blocks the version at "automated review," and staged approval requires a human 2FA on every release. The GitHub release path sidesteps that entirely and is the supported install.

### Option 3 — from source

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
- **External jailbreak payload registry** — file-based payload variants ingested from sibling `AI-Jailbreaks/` + `BlackFriday-GPTs-Prompts/` collections (NYX V4, Cronus, Bladwin 67, Opus 4.8, GPT 5.6, GLM RAGE, DAN, Dev Mode, …) with model-aware auto-routes (`claude-*` → one variant, `gpt-*` → another, `grok` → another). Fail-open: missing file → classic payload.
  - `9ROUTER_JAILBREAK_DIR=/path/to/collections` — override collection dir
  - `9ROUTER_JAILBREAK_DISABLE=1` — disable the registry
- **Transparency console** — signature rules detect injections (`G0DM0D3`, `VEIL`, Plinian register, collection markers); the developer console renders register + payload in live injection order.
- **Token-saver guardrail** — active payloads skip headroom compression (no third-party leak) and skip terseness prompts (no dilution).

> ⚠️ Use only on systems you are authorized to test.

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
