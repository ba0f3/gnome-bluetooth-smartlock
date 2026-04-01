#!/bin/sh -e

export G_MESSAGES_DEBUG=all
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1366x768
export SHELL_DEBUG=all


glib-compile-schemas schemas/

# GNOME 49+ replaced --nested with --devkit
GNOME_SHELL_VERSION=$(gnome-shell --version | sed 's/[^0-9]*//' | cut -d. -f1)
if [ "$GNOME_SHELL_VERSION" -ge 49 ] 2>/dev/null; then
    MODE_FLAG="--devkit"
else
    MODE_FLAG="--nested"
fi

echo "Starting GNOME Shell ($MODE_FLAG) with Bluetooth Smart Lock enabled..."
echo "Requires 'mutter-devkit' package on Fedora (sudo dnf install mutter-devkit)"
echo "You may need to enable the extension: gnome-extensions enable bluetooth-smartlock@ba0f3.github.com"

dbus-run-session -- \
    gnome-shell $MODE_FLAG \
                --wayland 2>&1 | \
    grep -i --line-buffered -C 3 "bluetooth-smartlock@ba0f3.github.com"
