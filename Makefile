# 9router-plinian — fork/patch build & install helper.
#
# This repo is a PATCH/FORK of upstream 9router. To ship changes into the
# running tray app, the package must be rebuilt, packed, and installed into
# the exact global prefix the tray loads from (the nvm node, NOT the default
# ~/.local that a plain `npm i -g` uses). `make 9router-plinian` does all of
# that in one step so a new user never has to know the prefix trick.
#
# Usage:
#   make                 # show help
#   make 9router-plinian # build + pack + install, then relaunch the tray

# Where the tray actually loads 9router-plinian from.
# 1. Follow TRAY_BIN symlink (the original mechanism).
# 2. If TRAY_BIN is not a symlink to the package cli.js (e.g. an npm shim from a
#    plain `npm i -g` overwrote it), fall back to searching nvm for the installed
#    package so `make` always installs to the right global prefix.
# 3. Final fallback: the running node's prefix (best-effort).
TRAY_BIN ?= /home/jars/.local/bin/9router
INSTALL_PREFIX := $(shell p=$$(readlink -f $(TRAY_BIN) 2>/dev/null); case "$$p" in */lib/node_modules/9router-plinian/cli.js) echo "$$p" | sed -E 's#/lib/node_modules/9router-plinian/cli\.js$$##';; *) found=$$(find $(HOME)/.nvm/versions/node -maxdepth 5 -path '*/node_modules/9router-plinian/package.json' -print -quit 2>/dev/null); if [ -n "$$found" ]; then dirname $$(dirname "$$found"); else node -p "require('path').dirname(require('path').dirname(process.execPath))"; fi;; esac)

VERSION := $(shell node -p "require('./package.json').version")
TGZ := ../9router-plinian-$(VERSION).tgz

.PHONY: help build pack install 9router-plinian

help:
	@echo "9router-plinian (fork of 9router) — build & install"
	@echo ""
	@echo "  make 9router-plinian   Build the app, pack a .tgz, and install it"
	@echo "                        into the global prefix the tray uses."
	@echo "                        Then relaunch the tray to see changes."
	@echo ""
	@echo "  make build            Next build only (compile src/)"
	@echo "  make pack             build + npm pack -> ../9router-plinian-$(VERSION).tgz"
	@echo "  make install          pack + npm install -g (to tray prefix)"
	@echo ""
	@echo "Install prefix (auto): $(INSTALL_PREFIX)"

build:
	npm run build

pack: build
	npm run cli:pack

install: pack
	npm install -g --prefix "$(INSTALL_PREFIX)" --force "$(TGZ)"

9router-plinian: install
	@echo ""
	@echo "✔ 9router-plinian $(VERSION) ter-install ke: $(INSTALL_PREFIX)"
	@echo "  Sekarang relaunch tray (kill dari tray, lalu jalankan 9router) untuk memuat app baru."
