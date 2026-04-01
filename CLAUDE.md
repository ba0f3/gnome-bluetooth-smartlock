# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A GNOME Shell extension that automatically locks the desktop when a paired Bluetooth device (phone, smartwatch) goes out of range, and optionally unlocks when it returns. Published as UUID `bluetooth-smartlock@ba0f3.github.com`.

## Common Commands

```bash
make build       # Compile GLib schemas and translations (run after schema or translation changes)
make dev         # Create symlink in ~/.local/share/gnome-shell/extensions/ for development
make install     # Build, package, and install the extension
make dist        # Create distributable .shell-extension.zip
make clean       # Remove compiled artifacts
make translate   # Extract translatable strings to .pot file

npx eslint *.js bluetooth/*.js   # Lint JavaScript files
./tools/shell.sh                 # Run extension in a nested GNOME Shell instance for testing
```

After `make dev`, changes to JS files take effect on GNOME Shell restart (Alt+F2, `r`). Schema changes require `make build` and a restart.

## Architecture

The extension has five main components that form a layered architecture:

**`extension.js`** — Lifecycle entry point. On `enable()`, initializes settings, creates the indicator and SmartLock instances, and wires them together via signal connections.

**`smartlock.js`** — Core logic. Subscribes to D-Bus Bluetooth signals, tracks the target device's connection state, and manages a timeout before locking. Calls `Main.screenShield` to lock/unlock. Device state is compared against the MAC address stored in GSettings.

**`bluetooth/dbus.js`** — BlueZ D-Bus layer. Calls `org.bluez` ObjectManager's `GetManagedObjects` to enumerate devices, and subscribes to `PropertiesChanged` / `InterfacesRemoved` signals to detect connect/disconnect events.

**`indicator.js`** — Status bar panel button. Shows a colored icon (green=connected, red=disconnected) and a menu to select the target device or open preferences. Hides itself during the `unlock-dialog` session mode.

**`settings.js`** — Thin GSettings wrapper. Provides typed getters/setters and helpers to connect/disconnect setting-change signals cleanly.

**`prefs.js`** — GTK4/Adwaita preferences window (runs in a separate process from the extension).

### GSettings Schema

Schema ID: `org.gnome.shell.extensions.bluetooth_smartlock`
Key settings: `active` (bool), `mac` (string, device MAC), `duration-in-seconds` (int, lock delay), `auto-unlock` (bool), `indicator` (bool, hide icon).

### Signal flow for lock

```
BlueZ D-Bus PropertiesChanged/InterfacesRemoved
  → bluetooth/dbus.js callback
  → smartlock.js: starts/cancels GLib timeout
  → timeout fires → Main.screenShield.lock()
```

## GNOME Shell API Notes

- The extension uses `Main.screenShield` for locking, `Main.sessionMode` for session-mode checks.
- D-Bus calls go through `Gio.DBus.system`; signals use `Gio.DBus.system.signal_subscribe`.
- All GLib/GObject signal connections made during `enable()` must be disconnected in `disable()` to avoid leaks.
- Compatible GNOME Shell versions: 48, 49, 50 (declared in `metadata.json`).

## ESLint Configuration

Extends `lint/eslintrc-gjs.yml` and `lint/eslintrc-shell.yml`. Key rules: 4-space indent, ES2021, JSDoc required for functions, `camelcase` with GObject exceptions (`^vfunc_`, `^on_`).
