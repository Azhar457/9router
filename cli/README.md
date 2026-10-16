# 9Router Plinian — Independent 9Router Fork with a Red-Team Toolkit

**Independent fork of [9Router](https://github.com/decolua/9router)** — the same multi-provider gateway, plus **Red Team Toolkit**, **Aurora Violet UI**, and **image generation for custom nodes**.

**One OpenAI-compatible endpoint for every AI coding tool — plus model-aware payload testing for authorized red-team work.**

**Connect all AI code tools (Claude Code, Cursor, Codex, OpenCode, Cline, OpenClaw...) to 40+ AI providers & 100+ models.**

[![GitHub Release](https://img.shields.io/github/v/release/Azhar457/9router)](https://github.com/Azhar457/9router/releases)
[![License](https://img.shields.io/npm/l/9router-plinian.svg)](./LICENSE)

[🌐 Website](https://9router.com) • [📖 Upstream Docs](https://github.com/decolua/9router) • [🍴 Fork](https://github.com/Azhar457/9router)

---

## 🍴 What's different from upstream 9Router?

- 🔴 **Red Team Toolkit** — Global Injection, external jailbreak payload registry, transparency console (details below)
- 🎨 **Aurora Violet + 5 palettes** — violet (default), sea, rose, amber, teal; header PaletteToggle, light/dark/system themes, semantic sidebar surfaces
- 🖼️ **Image generation for custom nodes** — any `openai-compatible` node can serve image models via the Text-to-Image page; `GET /v1/models/image` lists them
- 🆓 **Free-tier auto-combo** — `POST /api/combos/free-tier` finds + races free models, keeps per-family winners
- 📥 **Import from /models + Test All / Disable All Failed** — bulk provider management

---

## 🔴 Red Team Toolkit (authorized testing)

Fork-only feature set for red-team / security-research workflows:

- **Global Injection** — one master toggle drives register prompt + G0DM0D3 payload into the same system message (payload appended last, closest to the user query). Levels, identity, and custom payload configurable; legacy settings keys still honored.
- **External jailbreak payload registry** — 16 file-based variants ingested from sibling `AI-Jailbreaks/` + `BlackFriday-GPTs-Prompts/` collections (NYX V4, Cronus, Bladwin 67, Opus 4.8, GPT 5.6, GLM RAGE, DAN, Dev Mode, ...) with model-aware auto-routes (`claude-*` → Opus 4.8, `gpt-*` → Bladwin, `grok` → NYX, ...). Fail-open: missing file → classic payload.
  - `9ROUTER_JAILBREAK_DIR=/path/to/collections` — override collection dir
  - `9ROUTER_JAILBREAK_DISABLE=1` — disable the registry
- **Red-team transparency** — `injectionDetect` signature rules (G0DM0D3, VEIL, Plinian register, AI-Jailbreaks, BlackFriday); the developer transparency console renders register + payload in live injection order.
- **Token-saver guardrail** — active jailbreak payloads skip headroom compression (no third-party leak) and skip terseness prompts (no dilution).

> Use only on systems you are authorized to test.

---

## 🤔 Why this fork?

Upstream 9Router optimizes for saving tokens. **This fork does not** — it exists for red-team / model-research work, and that work is token-heavy by nature (injection payloads run 8KB–70KB per request). What it solves:

- 🔴 **Model-aware payload testing** — external jailbreak registry with per-model-family routes, so you test what actually lands on each model
- 🔍 **Injection transparency** — see register + payload in live send order, with estimated token cost per payload (aggregate ≈ chars/4)
- 🖼️ **Image generation for custom nodes** — any `openai-compatible` node serves image models via the Text-to-Image page
- 🎨 **5 palettes + themes** — violet (default), sea, rose, amber, teal; light/dark/system
- 📥 **Bulk provider management** — import a gateway's whole `/models` catalog, mass-test, mass-disable

Honest note: RTK and the other token savers still ship (inherited from upstream), but with Global Injection active they are **deliberately bypassed** for payload integrity — expect *higher* token use, with visibility into where it goes. Routing basics (fallback, multi-account, quota tracking) remain from upstream and are documented there.

---

## ⚡ Quick Start

### Install from GitHub Releases (the only supported path)

Installs the full fork build (Red Team Toolkit included) straight from this repo — no npmjs account or 2FA needed:

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

> 💡 **Why not npm?** `9router-plinian` ships security-research / red-team prompt payloads (dual-use content). npm's 2026-07-28 publish-time scanner + dual-use policy blocks the version at "automated review." The GitHub release path sidesteps that entirely and is the supported install.

🎉 Dashboard opens at `http://localhost:20128`

**1. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**2. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
9router-plinian                 # Start with default settings
9router-plinian --port 8080     # Custom port
9router-plinian --no-browser    # Don't open browser
9router-plinian --skip-update   # Skip auto-update check
9router-plinian --help          # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🔌 Connect to a Remote 9Router

Already running 9Router on another machine (e.g. a team server on your LAN)? Point this machine's CLI tools at it — no local server is started:

```bash
npx 9router connect http://<server-host>:20128                       # pick tools interactively
npx 9router connect http://<server-host>:20128 --tools claude,codex  # or choose up front
npx 9router connect --reset --tools claude,codex                     # undo
```

It logs in with the dashboard password (hidden prompt), reuses or creates an API key named `cli-<hostname>`, and writes each tool's config (backing up the original once as `*.bak-9router`).

Supported tools: `claude`, `codex`, `opencode`, `droid`, `crush`, `kilo`, `cline`, `pi`, `omp`, or `all`.

### Models

Models come from the **server's own CLI-tools configuration**, so a client gets whatever the operator already picked on the dashboard. Nothing is hardcoded.

| Tool | Model taken from (first match wins) |
|---|---|
| `claude` | tier flag (`--opus` …) → server's Claude tier → *left unset* (Claude Code's own default) |
| others | `--model` → that tool's own model on the server → server's OpenCode model → *tool skipped* |

`kilo` has no readable model on the server, so it always uses `--model` or the OpenCode model. `omp` (Oh My Pi) needs no model: it uses proxy discovery, so every server model appears under `9router` in `/model`. A Claude tier the server doesn't set is removed from your config rather than kept from an earlier run. A skipped tool makes the command exit `1`.

### Overriding the server's models

```bash
# One Claude tier; the other tiers still come from the server
npx 9router connect http://<server-host>:20128 --tools claude --sonnet cc/claude-sonnet-5-5

# Every Claude tier
npx 9router connect http://<server-host>:20128 --tools claude \
  --fable cc/claude-fable-5-1 --opus cc/claude-opus-5-5 \
  --sonnet cc/claude-sonnet-5-5 --haiku cc/claude-haiku-4-5-20251001

# All non-Claude tools at once
npx 9router connect http://<server-host>:20128 --tools codex,opencode,kilo --model ocg/deepseek-flash

# Claude and other tools in one run
npx 9router connect http://<server-host>:20128 --tools claude,codex --opus cc/claude-opus-5-5 --model gpt-6

# A different model per tool: --model covers every non-Claude tool in a run, so run once per tool
npx 9router connect http://<server-host>:20128 --tools codex --model gpt-6
npx 9router connect http://<server-host>:20128 --tools opencode --model ocg/glm-5.3
```

A model the server doesn't list is still written, with a `not listed by server` warning. To see the ids it serves: `curl http://<server-host>:20128/v1/models -H "Authorization: Bearer <your key>"`.

### Checking the current config

`9router show` prints what each CLI tool on this machine is currently set to — base URL, masked API key and models. It only reads local files and never contacts a server.

```bash
npx 9router show                 # every supported tool
npx 9router show claude          # one tool
npx 9router show claude codex    # several
npx 9router show claude --json   # machine-readable (key still masked)
```

```
✅ Claude Code
   File:     ~/.claude/settings.json
   Base URL: http://<server-host>:20128/v1
   API key:  sk-a1b…9f3c
   Models:
     fable   cc/claude-fable-5-1
     opus    cc/claude-opus-5-5
     sonnet  cc/claude-sonnet-5-5
```

Tools not pointed at 9router are listed as `not configured`. For Codex, OpenCode and Cline it also warns when a 9router entry exists but another provider is the active one.

### Other options

| Option | Purpose |
|---|---|
| `--password <pw>` | Dashboard password (or `NINE_ROUTER_PASSWORD`); prompted if omitted — preferred, keeps it out of shell history |
| `--save` | After a successful login, save the password for this server to `~/.9router/connect.env` (plain text, mode 600) so later runs skip the prompt. Delete the file to forget it |
| `--api-key <key>` | Use this key and skip login. The server's models can't be read without a login, so pass model flags |
| `--key-name <name>` | API key name to reuse/create (default `cli-<hostname>`) |
| `--print-env` | Also print `OPENAI_BASE_URL` / `OPENAI_API_KEY` for other CLIs |
| `--reset` | Remove the 9router settings from the selected tools |

See `9router connect --help` for the full list.

> ⚠️ Over plain `http://` the password and API key are sent unencrypted — use a trusted LAN/VPN or put HTTPS in front. The API key is stored in each tool's config file.

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (when running from source)

---

## 📚 Documentation

- **Fork README (full)**: https://github.com/Azhar457/9router/blob/master/README.md
- **Upstream 9Router**: https://github.com/decolua/9router • https://9router.com

---

## 🙏 Acknowledgments

- **[9Router](https://github.com/decolua/9router)** — upstream project this fork builds on
- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
