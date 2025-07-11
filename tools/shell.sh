#!/bin/sh -e

export G_MESSAGES_DEBUG=all
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768
export SHELL_DEBUG=all


glib-compile-schemas schemas/

dbus-run-session -- \
    gnome-shell --nested \
                --wayland 2>&1 | \
    grep -i --line-buffered -C 3 "gnome-bluetooth-smartlock@eleventeen"
