# Installing this fork — package: `9router-plinian`

This fork ships the same way upstream does: a CLI launcher package whose
`app/` contains the prebuilt dashboard bundle (`cli/scripts/build-cli.js`
produces it). This fork builds as its own npm package **`9router-plinian`** (binary
`9router-plinian`), so it can coexist with the official `9router` install.
The public-registry name `9router` belongs to upstream and is untouched.

## Route A — prebuilt release .tgz (recommended for users)

Grab the `9router-<version>.tgz` from this repo's **Releases** page, then:

```bash
npm install -g ./9router-<version>.tgz
```

Works without cloning and without an npm account.

## Route B — build it yourself from a clone

```bash
git clone https://github.com/Azhar457/9router.git
cd 9router
npm install                 # root deps (dashboard build)
npm install --prefix cli    # cli deps (esbuild for the MITM bundle)
npm run cli:pack            # → ./9router-<version>.tgz  (~14 MB)
npm install -g ./9router-<version>.tgz
```

## Route C — nightly/dev straight from your working tree

```bash
node cli/scripts/build-cli.js          # rebuild cli/app from source
cd cli && npm pack --pack-destination .. && cd ..
npm install -g ./9router-<version>.tgz
```

## Caveats

- **Coexistence**: binary is `9router-plinian`; official `9router` keeps
  working alongside it. Ports still collide if both servers run at once —
  start one of them with `-p <other-port>`.
- **Shared data dir**: both builds persist state under `~/.9router/`
  (SQLite DB, runtime node_modules, logs). Switching between official and
  fork builds is fine, but expect schema migrations to be shared.
- **postinstall scripts**: some npm setups block lifecycle scripts. The
  package needs its postinstall (runtime bootstrap). Allow it once:
  `npm config set allow-scripts=9router-plinian --location=user`.
- **Verify which build you run**: a plinian-developer deployment stamps
  `<install>/app/.plinian-deploy.json`; the hub sidebar also shows the
  Developer item only in this fork.

## Windows notes

Works on Windows 10/11 with Node ≥ 18 — no compiler/build tools needed
(native SQLite is deliberately NOT bundled; the runtime bootstrap installs
a pure-JS fallback into `~/.9router/`). Known friction points:

1. **Blocked postinstall** (newer npm): if you see an `install-scripts`
   warning during install, allow it once:
   ```powershell
   npm config set allow-scripts=9router-plinian --location=user
   npm i -g <tgz-or-url>
   ```
   Even if skipped, the CLI self-heals missing runtime deps on first start.
2. **Firewall prompt**: binding `0.0.0.0` triggers a Windows Firewall dialog.
   Run local-only to skip it entirely:
   ```powershell
   9router-plinian --host 127.0.0.1
   ```
3. **Tray**: uses PowerShell NotifyIcon on Windows (no external binaries);
   Hide-to-Tray writes diagnostics to `%USERPROFILE%\.9router\logs\tray-bg.log`.
4. **Long paths**: only relevant on old Win10 without long-path support —
   keep your npm prefix short if installs fail with ENAMETOOLONG.

## Releasing a new build (maintainer)

```bash
# 1. bump cli/package.json version (keep -plinian.N suffix)
# 2. build + pack
npm run cli:pack        # from repo root
# 3. attach the tgz to a GitHub Release on this fork
```
