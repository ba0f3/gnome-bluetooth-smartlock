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
