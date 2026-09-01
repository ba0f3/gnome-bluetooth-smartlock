all: build

PO_FILES := $(shell find $(PODIR) -name '*.po')
GETTEXT_DOMAIN = 'bluetooth-smartlock'
POT_FILE = po/${GETTEXT_DOMAIN}.pot

translate:
	xgettext --from-code=UTF-8 *.js --output=${POT_FILE}

%.po: translate
	msgmerge -N -U $@ ${POT_FILE}

build: ${PO_FILES}
	glib-compile-schemas ./schemas

EXTRA_SOURCES = icons bluetooth indicator.js log.js settings.js settings.ui smartlock.js LICENSE README.md

dist: build
	gnome-extensions pack -f --podir=po --gettext-domain=${GETTEXT_DOMAIN} $(addprefix --extra-source=,$(EXTRA_SOURCES)) .

install: dist
	gnome-extensions install -f bluetooth-smartlock@ba0f3.github.com.shell-extension.zip

dev: build
	rm -rf $(HOME)/.local/share/gnome-shell/extensions/bluetooth-smartlock@ba0f3.github.com
	ln -snf $(CURDIR) $(HOME)/.local/share/gnome-shell/extensions/bluetooth-smartlock@ba0f3.github.com

clean:
	rm -f schemas/gschemas.compiled
	rm -f bluetooth-smartlock@ba0f3.github.com.shell-extension.zip

# ── bt-rssi D-Bus service ───────────────────────────────────────────────────
SERVICE_DIR     := services/bt-rssi
SERVICE_VERSION := $(shell awk -F'"' '/^version/ {print $$2; exit}' $(SERVICE_DIR)/Cargo.toml)
SERVICE_BIN     := $(SERVICE_DIR)/target/release/bt-rssi
SERVICE_STAGE   := $(CURDIR)/bt-rssi-$(SERVICE_VERSION)
SERVICE_TARBALL := bt-rssi-$(SERVICE_VERSION).tar.gz

.PHONY: service-build service-dist

service-build:
	cd $(SERVICE_DIR) && cargo build --release

service-dist: service-build tools/install-bt-rssi.sh
	rm -rf $(SERVICE_STAGE) $(SERVICE_TARBALL)
	mkdir -p $(SERVICE_STAGE)
	install -Dm755 $(SERVICE_BIN)                                          $(SERVICE_STAGE)/usr/local/bin/bt-rssi
	install -Dm644 $(CURDIR)/services/bt-rssi.service                       $(SERVICE_STAGE)/etc/systemd/system/bt-rssi.service
	install -Dm644 $(CURDIR)/services/org.gnome.BluetoothRSSI.conf         $(SERVICE_STAGE)/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
	install -Dm644 $(CURDIR)/services/org.gnome.BluetoothRSSI.dbus-service $(SERVICE_STAGE)/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service
	install -Dm755 $(CURDIR)/tools/install-bt-rssi.sh                      $(SERVICE_STAGE)/install.sh
	tar -C $(SERVICE_STAGE) -czf $(SERVICE_TARBALL) .
	rm -rf $(SERVICE_STAGE)
	@echo "built $(SERVICE_TARBALL)"
