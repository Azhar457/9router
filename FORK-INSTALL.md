# Installing this fork — package: `9router-plinian`

This fork ships the same way upstream (`decolua/9router`) does: a CLI launcher
package whose `app/` contains the prebuilt dashboard bundle (`cli/scripts/build-cli.js`
produces it). This fork builds as its own npm package **`9router-plinian`** (binary
`9router-plinian`), so it can coexist with the official `9router` install. The
public-registry name `9router` belongs to upstream and is untouched.

## Quick start (recommended for contributors / new users)

This is a **fork/patch of `decolua/9router`** — same upstream code, plus Plinian
features. To rebuild and ship your changes into the running tray app in **one
step**, use the Makefile (it handles the build → pack → install, and installs into
the exact global prefix the tray actually loads from — a plain `npm i -g` can land
in the wrong prefix and silently not update the tray):

```bash
make 9router-plinian     # build + pack + install; then relaunch the tray
```

`make` (no args) prints help. Prefer this over the manual steps below.

**Identity & versioning.** The fork's identity is the package/binary name
(`9router-plinian`) plus branding — **not** a version suffix. The `version` field in
both `package.json` and `cli/package.json` is kept **exactly equal to upstream**
(`decolua/9router` master). This is deliberate: it lets the fork `rebase` onto new
upstream releases without merge conflicts on the version line. Per-fork releases are
distinguished with **git tags** `v0.5.55-plinian.N`, never by editing the version field.

## Route A — prebuilt release `.tgz` (recommended for users)

Download `9router-plinian-<version>.tgz` from this fork's **Releases** page, then:

```bash
npm install -g ./9router-plinian-<version>.tgz
```

Works without cloning and without an npm account. The published binary is `9router-plinian`.

## Route B — build it yourself from a clone

```bash
git clone https://github.com/Azhar457/9router.git
cd 9router
npm install                 # root deps (dashboard build)
npm install --prefix cli    # cli deps (esbuild for the MITM bundle)
make 9router-plinian        # → build + pack + install to the tray's prefix
```

Manual equivalent (only if you skip the Makefile):

```bash
npm run cli:pack            # → ./9router-plinian-<version>.tgz  (~14 MB)
npm install -g ./9router-plinian-<version>.tgz
```

> ⚠️ **Prefix gotcha:** the tray launches the package from the nvm-node global
> prefix (`/home/jars/.nvm/.../lib/node_modules/9router-plinian`), but a plain
> `npm install -g` may install to `~/.local` instead. If the tray doesn't change
> after install, install to the tray's prefix explicitly:
> `npm install -g --prefix "$(readlink -f /home/jars/.local/bin/9router | sed -E 's#/lib/node_modules/9router-plinian(/cli\.js)?##')" ./9router-plinian-<version>.tgz`
> — or just use `make 9router-plinian`, which does this automatically.

## Route C — nightly/dev straight from your working tree

```bash
node cli/scripts/build-cli.js          # rebuild cli/app from source
cd cli && npm pack --pack-destination .. && cd ..
npm install -g ./9router-plinian-<version>.tgz
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

## Syncing upstream updates (keep Plinian features)

The fork tracks `decolua/9router` as `upstream`. Because Plinian features live in
separate files (`open-sse/rtk/plinian.js`, `plinianPrompts.js`, `godmode.js`,
`headroom.js`, the `/dashboard/developer/*` pages, `plinianScoring.js`, …) that
upstream never touches, pulling upstream in is conflict-free except for the version
field (already handled — see Identity & versioning above).

To absorb a new upstream release:

```bash
git fetch upstream
git rebase upstream/master      # Plinian commits re-apply on top of new upstream
npm install && npm install --prefix cli
npm run build                   # make sure the dashboard still builds green
git push origin master --force-with-lease   # history was rebased
```

The only file that may still conflict is `src/shared/constants/config.js` if an
upstream PR adds new config keys there — resolve by taking both sides. Everything
else (provider registry, translator engine, CLI launcher skeleton) merges cleanly
because the fork does not modify those files.

## Releasing a new build (maintainer)

```bash
# 1. make sure package.json / cli/package.json version == upstream (do NOT add -plinian.N)
# 2. build + pack  (produces 9router-plinian-<upstream-version>.tgz)
npm run cli:pack
# 3. tag the fork release (this is where -plinian.N lives — NOT the version field)
git tag v0.5.55-plinian.N
git push origin v0.5.55-plinian.N
# 4. attach the tgz to a GitHub Release on this fork
```

Users then install via Route A. (Publishing to the npm registry is optional and not
required — the `.tgz` on Releases is the supported distribution.)
