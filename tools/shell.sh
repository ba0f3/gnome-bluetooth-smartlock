#!/bin/sh -e

export G_MESSAGES_DEBUG=all
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768
export SHELL_DEBUG=all


glib-compile-schemas schemas/

echo "Starting GNOME Shell in nested mode with Bluetooth Smart Lock enabled..."

echo "You may need to enable the extension gnome-extensions enable bluetooth-smartlock@ba0f3.github.com"

dbus-run-session -- \
    gnome-shell --nested \
                --wayland 2>&1 | \
    grep -i --line-buffered -C 3 "bluetooth-smartlock@ba0f3.github.com"
