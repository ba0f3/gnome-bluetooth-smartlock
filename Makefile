all: build

PO_FILES := $(shell find $(PODIR) -name '*.po')
MO_FILES := $(shell find $(PODIR) -name '*.mo')
GETTEXT_DOMAIN = 'bluetooth-smartlock'
POT_FILE = po/${GETTEXT_DOMAIN}.pot

translate:
	xgettext --from-code=UTF-8 *.js --output=${POT_FILE}

%.po: translate
	msgmerge -N -U $@ ${POT_FILE}

build: ${PO_FILES}
	glib-compile-schemas ./schemas

dist: build
	gnome-extensions pack -f --podir=po --gettext-domain=${GETTEXT_DOMAIN}  --extra-source=icons --extra-source=indicator.js  --extra-source=perfs.js --extra-source=settings.js --extra-source=settings.ui  --extra-source=smartlock.js --extra-source=LICENSE --extra-source=README.md .
	zip -ur smartlock@huy.im.shell-extension.zip ${MO_FILES}


install: dist
	gnome-extensions install -f smartlock@huy.im.shell-extension.zip

clean:
	rm -f schemas/gschemas.compiled
	rm -f bluetooth-smartlock@ba0f3.github.com.shell-extension.zip