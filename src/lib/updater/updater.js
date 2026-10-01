// Standalone detached updater process.
// Spawns `npm i -g <pkg>@latest`, exposes progress via tiny HTTP server.
// Survives after parent Next server exits (detached + unref by spawner).

const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");

const packageName = process.env.UPDATER_PKG_NAME || "9router-plinian";
// GitHub is the update source of truth (npm is deprecated/blocked). The
// updater downloads the latest release tarball and installs it via
// `npm i -g <file>` — same path as the documented manual install. Env
// overridable so forks / mirrors / self-hosted installs can point elsewhere.
const ghRepo = process.env.UPDATER_GH_REPO || "Azhar457/9router";
const ghAsset = process.env.UPDATER_GH_ASSET || "9router-plinian-latest.tgz";
const ghUrl = process.env.UPDATER_GH_URL ||
  `https://github.com/${ghRepo}/releases/latest/download/${ghAsset}`;
const port = parseInt(process.env.UPDATER_PORT || "20129", 10);
const tailLines = parseInt(process.env.UPDATER_TAIL_LINES || "8", 10);
const maxRetries = parseInt(process.env.UPDATER_RETRIES || "3", 10);
const retryDelayMs = parseInt(process.env.UPDATER_RETRY_DELAY_MS || "5000", 10);
const lingerMs = parseInt(process.env.UPDATER_LINGER_MS || "30000", 10);
const waitMinMs = parseInt(process.env.UPDATER_WAIT_MIN_MS || "3000", 10);
const waitMaxMs = parseInt(process.env.UPDATER_WAIT_MAX_MS || "15000", 10);
const waitCheckMs = parseInt(process.env.UPDATER_WAIT_CHECK_MS || "500", 10);
const appPort = parseInt(process.env.UPDATER_APP_PORT || "20128", 10);

// Data directory (match mitm/paths.js logic)
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}
const updateDir = path.join(getDataDir(), "update");
try { fs.mkdirSync(updateDir, { recursive: true }); } catch { /* best effort */ }
const statusFile = path.join(updateDir, "status.json");
const logFile = path.join(updateDir, "install.log");

const state = {
  phase: "starting",
  packageName,
  startedAt: Date.now(),
  finishedAt: null,
  attempt: 0,
  maxRetries,
  done: false,
  success: false,
  exitCode: null,
  error: null,
  logTail: [],
};

function pushLog(line) {
  const trimmed = line.replace(/\r?\n$/, "");
  if (!trimmed) return;
  state.logTail.push(trimmed);
  if (state.logTail.length > tailLines) state.logTail = state.logTail.slice(-tailLines);
  try { fs.appendFileSync(logFile, `${trimmed}\n`); } catch { /* best effort */ }
}

function persistStatus() {
  try { fs.writeFileSync(statusFile, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
}

function setPhase(phase) {
  state.phase = phase;
  persistStatus();
}

// HTTP server exposing status (browser polls this while Next server is dead)
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/update/status" || req.url === "/") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.on("error", (e) => {
  state.error = `status server error: ${e.message}`;
  persistStatus();
});

server.listen(port, "127.0.0.1", () => {
  persistStatus();
  waitForAppExit().then(runInstall);
});

// Check if app port is still being listened on (= app server still alive)
function isAppPortBusy() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(appPort, "127.0.0.1");
  });
}

// Wait for app process to fully exit before running npm (avoids Windows file-lock)
async function waitForAppExit() {
  setPhase("waitingForExit");
  pushLog(`[updater] waiting for app to exit (min ${Math.round(waitMinMs / 1000)}s)...`);

  // Hard minimum delay: OS needs time to release file handles
  await sleep(waitMinMs);

  // Poll app port until free or max timeout
  const deadline = Date.now() + (waitMaxMs - waitMinMs);
  while (Date.now() < deadline) {
    const busy = await isAppPortBusy();
    if (!busy) {
      pushLog(`[updater] app port :${appPort} is free, proceeding`);
      return;
    }
    await sleep(waitCheckMs);
  }
  pushLog(`[updater] timeout waiting for app, proceeding anyway`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runInstall() {
  state.attempt += 1;
  setPhase("installing");
  pushLog(`[updater] attempt ${state.attempt}/${maxRetries} — GitHub: ${ghUrl}`);

  const isWin = process.platform === "win32";
  const tmpDir = path.join(getDataDir(), "update");
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
  const tarball = path.join(tmpDir, "update.tgz");

  // Step 1: download the GitHub release tarball (curl on unix, PowerShell on win).
  const dl = isWin
    ? {
        cmd: "powershell",
        args: [
          "-NoProfile", "-NonInteractive", "-Command",
          `Invoke-WebRequest -UseBasicParsing -Uri "${ghUrl}" -OutFile "${tarball}"`,
        ],
      }
    : { cmd: "curl", args: ["-fsSL", ghUrl, "-o", tarball] };

  // Step 2: install the local tarball globally (the documented install path).
  const npmCmd = isWin ? "npm.cmd" : "npm";
  const install = { cmd: npmCmd, args: ["i", "-g", tarball, "--prefer-online"] };

  const steps = [dl, install];
  let step = 0;
  let lastCode = 1;

  const runStep = () => {
    const spec = steps[step];
    pushLog(
      `[updater] ${step === 0 ? "downloading" : "installing"} (${step + 1}/2) ...`
    );
    const child = spawn(spec.cmd, spec.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: isWin,
    });

    child.stdout.on("data", (buf) => {
      buf.toString().split(/\r?\n/).forEach(pushLog);
      persistStatus();
    });
    child.stderr.on("data", (buf) => {
      buf.toString().split(/\r?\n/).forEach(pushLog);
      persistStatus();
    });

    child.on("error", (e) => {
      pushLog(`[updater] spawn error (${step === 0 ? "download" : "install"}): ${e.message}`);
      handleFailure();
    });

    child.on("close", (code) => {
      lastCode = code;
      if (code === 0) {
        step += 1;
        if (step < steps.length) {
          runStep();
          return;
        }
        pushLog(`[updater] update complete`);
        finalize(true, 0, null);
        return;
      }
      handleFailure();
    });
  };

  function handleFailure() {
    pushLog(`[updater] ${step === 0 ? "download" : "install"} failed (code=${lastCode})`);
    if (state.attempt < maxRetries) {
      pushLog(`[updater] retrying full update in ${Math.round(retryDelayMs / 1000)}s...`);
      setTimeout(() => { step = 0; runStep(); }, retryDelayMs);
      return;
    }
    finalize(false, lastCode, `Update failed after ${maxRetries} attempts`);
  }

  runStep();
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? `open "${url}"`
    : platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  try { spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref(); } catch { /* ignore */ }
}

// Wait until app port is listening (server alive again), then open dashboard
async function waitForAppAndOpenBrowser() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const busy = await isAppPortBusy();
    if (busy) {
      openBrowser(`http://localhost:${appPort}/dashboard`);
      pushLog(`[updater] app ready, opened dashboard`);
      return;
    }
    await sleep(1000);
  }
  pushLog(`[updater] app not responding within 30s, skip browser open`);
}

function relaunchApp() {
  if (process.env.UPDATER_RELAUNCH !== "1") return;
  const cmd = process.env.UPDATER_RELAUNCH_CMD;
  if (!cmd) return;
  let args = [];
  try { args = JSON.parse(process.env.UPDATER_RELAUNCH_ARGS || "[]"); } catch { /* noop */ }
  const isWin = process.platform === "win32";
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: isWin,
      env: { ...process.env, UPDATER_RELAUNCH: "", UPDATER_RELAUNCH_CMD: "", UPDATER_RELAUNCH_ARGS: "" },
    });
    child.unref();
    pushLog(`[updater] relaunched: ${cmd} ${args.join(" ")} (pid=${child.pid})`);
    // Wait for new app to come up, then auto-open browser so user sees the result
    waitForAppAndOpenBrowser();
  } catch (e) {
    pushLog(`[updater] relaunch failed: ${e.message}`);
  }
}

function finalize(success, exitCode, error) {
  state.done = true;
  state.success = success;
  state.exitCode = exitCode;
  state.error = error;
  state.finishedAt = Date.now();
  setPhase(success ? "done" : "error");
  if (success) relaunchApp();
  // Linger so browser can poll final status, then exit & close the port
  setTimeout(() => {
    try { server.close(); } catch { /* ignore */ }
    process.exit(success ? 0 : 1);
  }, lingerMs);
}
