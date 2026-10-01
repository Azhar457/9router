# 9Router Plinian — Independent 9Router Fork with a Red-Team Toolkit

**Independent fork of [9Router](https://github.com/decolua/9router)** — the same multi-provider gateway, plus **Red Team Toolkit**, **Aurora Violet UI**, and **image generation for custom nodes**.

**One OpenAI-compatible endpoint for every AI coding tool — plus model-aware payload testing for authorized red-team work.**

**Connect all AI code tools (Claude Code, Cursor, Codex, OpenCode, Cline, OpenClaw...) to 40+ AI providers & 100+ models.**

[![npm](https://img.shields.io/npm/v/9router-plinian.svg)](https://www.npmjs.com/package/9router-plinian)
[![Downloads](https://img.shields.io/npm/dm/9router-plinian.svg)](https://www.npmjs.com/package/9router-plinian)
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

### Option 1 — GitHub Releases tarball (primary, always works)

Installs the full fork build (Red Team Toolkit included) straight from this repo — no npmjs account or 2FA needed:

```bash
curl -fsSL https://github.com/Azhar457/9router/releases/latest/download/9router-plinian-0.5.96.tgz -o /tmp/9router-plinian.tgz
npm install -g /tmp/9router-plinian.tgz
9router-plinian
```

PowerShell:

```powershell
curl.exe -fsSL https://github.com/Azhar457/9router/releases/latest/download/9router-plinian-0.5.96.tgz -o $env:TEMP\9router-plinian.tgz
npm install -g $env:TEMP\9router-plinian.tgz
9router-plinian
```

> `npm install -g <file>` still resolves the package's few small dependencies (react, node-forge, …) from whatever registry your npm is configured to use — a mirror counts. Only the package itself is fetched from GitHub.

### Option 2 — npm registry (when 0.5.96 is live)

The fork is published as `9router-plinian` on npmjs. Because it declares dual-use content, new versions go through npm's staged + 2FA pipeline; once `0.5.96` is promoted it's available via:

```bash
npm install -g 9router-plinian
9router-plinian
```

Until then, Option 1 is the way in.

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
