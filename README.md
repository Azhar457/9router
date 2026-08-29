<div align="center">
  <img src="./images/9router.png?1" alt="9Router Plinian Dashboard" width="800"/>
</div>

# 9Router Plinian — AI Routing Gateway (Red-Team fork)

> Fork of [9Router](https://github.com/decolua/9router) — local AI routing gateway + dashboard, extended with **Red-Team / jailbreak-injection & transparency** tooling on the Developer page.

**Connect all AI code tools (Claude Code, Cursor, OpenCode, Codex, Cline, Gemini CLI, Copilot...) to 40+ providers & 100+ models. Save 20–40% tokens with RTK Token Saver + auto-fallback to free/cheap models.**

[![npm](https://img.shields.io/npm/v/9router-plinian.svg)](https://www.npmjs.com/package/9router-plinian)
[![License](https://img.shields.io/npm/l/9router-plinian.svg)](https://github.com/Azhar457/9router/blob/main/LICENSE)

---

## 🔧 What's different in this fork (Plinian)

This fork keeps everything from upstream 9Router and adds Red-Team features on the **Developer** dashboard tab:

- **Red-Team Toolkit** — apply prompt transforms (base64 N-pass, ROT13/N, leetspeak, homoglyph, zero-width, url-encode, HTML-entity, hex, reverse, upper/lower, strip-spaces) with presets and a step-by-step reveal.
- **Injection Transparency** — reconstruct exactly what the gateway injects (Godmode + Plinian + Token Saver) per stage, with an **Outbound** view showing the final request (System + User + tool_result) sent to the model.
- **Jailbreak detection** — classifies model responses as `CRITICAL` / `HIGH` / `SAFE`, with a context-template guard (Researcher / Military / Deep-dive / Threat-intel) to cut false positives.

Everything else (RTK Token Saver, multi-account fallback, provider hub, dashboard) is unchanged from upstream.

---

## ⚡ Quick Start

```bash
npm install -g 9router-plinian
9router-plinian
```

Dashboard opens at `http://localhost:20128`.

**2. Connect a FREE provider (no signup):** Dashboard → Providers → Connect **Kiro AI** (free Claude) or **OpenCode Free** → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🤝 Coexists with the official `9router`

You do **not** need to uninstall the official `9router` to use this fork — they are separate npm packages with separate commands (`9router-plinian` vs `9router`).

- Run **just one** of them, or
- Run **both** by giving each a different port:

```bash
9router-plinian --port 20128
9router          --port 20129
```

> Note: both default to the same data dir `~/.9router`. To keep their data fully independent when running concurrently, set a separate `DATA_DIR` for one of them:
> ```bash
> DATA_DIR="$HOME/.9router-plinian" 9router-plinian --port 20128
> ```

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

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider — any tool with an OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%/9router/db/data.sqlite`

---

## 📚 Documentation

- Upstream docs: https://github.com/decolua/9router
- This fork: https://github.com/Azhar457/9router

## 🙏 Acknowledgments

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — original Go implementation
- Based on [9Router](https://github.com/decolua/9router) by decolua

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
