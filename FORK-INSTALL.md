# Installing this fork (Azhar457/9router)

This fork ships the same way upstream does: a CLI launcher package whose
`app/` contains the prebuilt dashboard bundle (`cli/scripts/build-cli.js`
produces it). The npm name `9router` on the public registry belongs to the
**official** project — installs from this fork must use one of the routes
below. None of them touch the official registry.

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

- **Bin collision**: this fork installs the same `9router` binary name.
  Install only one of (official | fork) globally at a time, or relink:
  `npm i -g <tgz> && npm link` semantics mean the last global install wins
  the symlink. To run both side-by-side, use `--prefix` into separate dirs.
- **Shared data dir**: both builds persist state under `~/.9router/`
  (SQLite DB, runtime node_modules, logs). Switching between official and
  fork builds is fine, but expect schema migrations to be shared.
- **postinstall scripts**: some npm setups block lifecycle scripts. The
  package needs its postinstall (runtime bootstrap). Allow it once:
  `npm config set allow-scripts=9router --location=user`.
- **Verify which build you run**: a plinian-developer deployment stamps
  `<install>/app/.plinian-deploy.json`; the hub sidebar also shows the
  Developer item only in this fork.

## Releasing a new build (maintainer)

```bash
# 1. bump cli/package.json version (keep -plinian.N suffix)
# 2. build + pack
npm run cli:pack        # from repo root
# 3. attach the tgz to a GitHub Release on this fork
```
