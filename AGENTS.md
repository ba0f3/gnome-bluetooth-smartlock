# AGENTS.md

Guidance for AI coding agents (Cursor, Copilot, and similar tools) working in this repository. For Claude Code–specific notes, see [CLAUDE.md](CLAUDE.md).

## What this project is

GNOME Shell extension **Bluetooth Smart Lock** (UUID `bluetooth-smartlock@ba0f3.github.com`). It locks the session when a chosen paired Bluetooth device disconnects, and optionally unlocks when it reconnects. Upstream: [ba0f3/gnome-bluetooth-smartlock](https://github.com/ba0f3/gnome-bluetooth-smartlock).

## Before you change code

- Read the file you are editing and neighbors; match existing style (imports, naming, JSDoc level).
- Prefer small, focused diffs. Do not refactor unrelated code or add docs the user did not ask for.
- All user-facing strings and comments in **English**.
- Shell extension compatibility is declared in `metadata.json` (currently GNOME Shell 48–50).

## Build and verify

```bash
make build          # After schema or translation changes
make dist           # Produces bluetooth-smartlock@ba0f3.github.com.shell-extension.zip
make clean
npx eslint *.js bluetooth/*.js
```

- `make dev` symlinks the repo into `~/.local/share/gnome-shell/extensions/` for local testing; reload Shell (e.g. Alt+F2, `r`) after JS edits.
- `prefs.js` runs in the preferences process; `extension.js` and the rest run in GNOME Shell. Test assumptions against the right runtime.
- Nested Shell: `./tools/shell.sh` when available in the environment.

**Dependencies for `make dist`:** `gettext`, `gnome-shell` (provides `gnome-extensions`), and GLib schema tools (see CI).

## Architecture (short)

| Area | Role |
|------|------|
| `extension.js` | `enable()` / `disable()`, wiring |
| `smartlock.js` | Lock delay, device state, `Main.screenShield` |
| `bluetooth/dbus.js` | BlueZ via D-Bus (`Gio.DBus.system`) |
| `indicator.js` | Panel UI and menu |
| `settings.js` | GSettings wrapper |
| `prefs.js` | GTK4 preferences |

Schema: `org.gnome.shell.extensions.bluetooth_smartlock` (see `schemas/*.xml`).

Disconnect all signals and timers in `disable()` to avoid leaks.

## Linting

ESLint config: `.eslintrc.yml` with `lint/eslintrc-gjs.yml` and `lint/eslintrc-shell.yml`. Expect 4-space indent, ES2021, JSDoc on functions, and GObject naming exceptions where applicable.

## CI and releases

- Workflow: [.github/workflows/release.yml](.github/workflows/release.yml).
- Pushing a tag matching `v*` builds with `make dist` and attaches the `.shell-extension.zip` to a GitHub Release.
- Release workflow does not bump `metadata.json`; align versioning with your release process if you publish to extensions.gnome.org.

## What not to do

- Do not strip license headers or change UUID / extension id without an explicit product decision.
- Do not assume Bluetooth hardware or BlueZ is available in the agent’s sandbox; prefer code reasoning and static checks unless the user runs tests locally.
