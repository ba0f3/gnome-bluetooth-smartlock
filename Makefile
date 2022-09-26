all: build

build:
	xgettext --from-code=UTF-8 *.js --output=po/bluetooth-smartlock.pot
	glib-compile-schemas ./schemas

dist: build
	rm -f bluetooth-smartlock@ba0f3.github.com.shell-extension.zip
	gnome-extensions pack -f --podir=po  --extra-source=icons --extra-source=indicator.js  --extra-source=perfs.js --extra-source=settings.js --extra-source=settings.ui  --extra-source=smartlock.js --extra-source=LICENSE --extra-source=README.md . --out-dir=./

install: dist
	gnome-extensions install -f smartlock@huy.im.shell-extension.zip

clean:
	rm -f schemas/gschemas.compiled
	rm -f bluetooth-smartlock@ba0f3.github.com.shell-extension.zip