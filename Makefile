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

# Where the tray actually loads 9router-plinian from. Resolved from the tray
# symlink so the install always lands in the right global prefix. Falls back to
# the running node's global prefix if the symlink is missing.
TRAY_BIN ?= /home/jars/.local/bin/9router
INSTALL_PREFIX := $(shell p=$$(readlink -f $(TRAY_BIN) 2>/dev/null | sed -E 's#/lib/node_modules/9router-plinian(/cli\.js)?##'); if [ -n "$$p" ]; then echo "$$p"; else node -p "require('path').dirname(require('path').dirname(process.execPath))"; fi)

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
