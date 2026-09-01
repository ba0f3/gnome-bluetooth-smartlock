# Services Docs + Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the `bt-rssi` D-Bus service, produce a self-contained release tarball for it via `make service-dist`, and publish it alongside the existing extension `.shell-extension.zip` on each GitHub Release.

**Architecture:** The service already exists in `services/bt-rssi/` (Rust, `zbus` + `tokio`) plus a systemd unit and two D-Bus files. This plan adds the *plumbing* — an `install.sh` helper, Makefile targets that build and package it, CI steps that publish the package, and docs that surface the feature to users. No service code is modified.

**Tech Stack:** Bash (install script), GNU Make (build/packaging), GitHub Actions + `gh` (release upload), Markdown (docs). The Rust toolchain is already a CI dependency.

## Global Constraints

From the spec — every task's requirements implicitly include these:

- Do not modify any file under `services/bt-rssi/src/` or `services/bt-rssi.service`, `services/org.gnome.BluetoothRSSI.conf`, `services/org.gnome.BluetoothRSSI.dbus-service`.
- Do not modify the existing `dist`, `install`, `dev`, `build`, `translate`, `clean`, or `all` Makefile targets — only append.
- All user-facing strings and code comments in English.
- All commits use the imperative-mood subject line, ≤72 chars, scoped to one logical change.
- The staged tarball layout (when extracted) must be: top-level `install.sh` + `usr/local/bin/bt-rssi` + `etc/systemd/system/bt-rssi.service` + `etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf` + `usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service`. The install script reads from these relative paths.
- The `install.sh` script must be idempotent on both install (re-running is a no-op) and uninstall (re-running tolerates already-missing files).
- The `install.sh` script must refuse to run as a non-root user and exit non-zero with a clear message.
- The `install.sh` script must support `install` (default) and `--uninstall` modes. No other flags are required.

## File Structure

**New files**
- `services/README.md` — service documentation
- `tools/install-bt-rssi.sh` — install/uninstall helper

**Modified files**
- `README.md` — surface proximity locking + new release artifact
- `Makefile` — append `service-build` and `service-dist` targets
- `.github/workflows/release.yml` — add service packaging step + attach tarball
- `.gitignore` — exclude cargo `target/` and built tarball

## Task Index

- Task 1: Create `tools/install-bt-rssi.sh`
- Task 2: Update `.gitignore`
- Task 3: Extend `Makefile` with service targets
- Task 4: Create `services/README.md`
- Task 5: Update root `README.md`
- Task 6: Update `.github/workflows/release.yml`
- Task 7: End-to-end verification

---

## Task 1: Create `tools/install-bt-rssi.sh`

**Files:**
- Create: `tools/install-bt-rssi.sh` (executable, `chmod 755`)

**Interfaces:**
- Consumes: nothing (the script self-discovers its location via `BASH_SOURCE`).
- Produces: an idempotent installer that, when run from the root of the extracted tarball, places files at `/usr/local/bin/bt-rssi`, `/etc/systemd/system/bt-rssi.service`, `/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf`, `/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service`; runs `systemctl daemon-reload`; reloads `dbus.service` (tolerates failure). With `--uninstall`, reverses the above and `userdel`s `bt-rssi` (tolerates already-gone state).

- [ ] **Step 1: Write the script**

Create `tools/install-bt-rssi.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# install.sh — install or uninstall the bt-rssi D-Bus service.
# Default mode installs; pass --uninstall to remove.

set -euo pipefail

log()  { printf '[install-bt-rssi] %s\n' "$*" >&2; }
die()  { log "error: $*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Resolve paths relative to this script so the tarball can be extracted
# anywhere (the script expects its staged file tree beside it).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN_SRC="${SCRIPT_DIR}/usr/local/bin/bt-rssi"
UNIT_SRC="${SCRIPT_DIR}/etc/systemd/system/bt-rssi.service"
POLICY_SRC="${SCRIPT_DIR}/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf"
ACTIVATE_SRC="${SCRIPT_DIR}/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service"

do_install() {
    [[ -f "$BIN_SRC"      ]] || die "missing staged binary:      $BIN_SRC"
    [[ -f "$UNIT_SRC"     ]] || die "missing staged unit:        $UNIT_SRC"
    [[ -f "$POLICY_SRC"   ]] || die "missing staged policy:      $POLICY_SRC"
    [[ -f "$ACTIVATE_SRC" ]] || die "missing staged activation:  $ACTIVATE_SRC"

    have systemctl || die "systemctl not found — is systemd installed?"
    have install   || die "coreutils install(1) not found"

    id -u bt-rssi >/dev/null 2>&1 || \
        useradd --system --shell /usr/sbin/nologin bt-rssi

    install -Dm755 "$BIN_SRC"      /usr/local/bin/bt-rssi
    install -Dm644 "$UNIT_SRC"     /etc/systemd/system/bt-rssi.service
    install -Dm644 "$POLICY_SRC"   /etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
    install -Dm644 "$ACTIVATE_SRC" /usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service

    systemctl daemon-reload
    systemctl reload dbus.service 2>/dev/null || \
        log "warning: failed to reload dbus.service (continuing)"

    log "installed"
    log "  binary:    /usr/local/bin/bt-rssi"
    log "  unit:      /etc/systemd/system/bt-rssi.service"
    log "  policy:    /etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf"
    log "  activate:  /usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service"
    log "enable and start with:  systemctl enable --now bt-rssi.service"
}

do_uninstall() {
    have systemctl && systemctl disable --now bt-rssi.service 2>/dev/null || true

    rm -f \
        /usr/local/bin/bt-rssi \
        /etc/systemd/system/bt-rssi.service \
        /etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf \
        /usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service

    have userdel && userdel bt-rssi 2>/dev/null || true

    have systemctl && systemctl daemon-reload || true
    have systemctl && systemctl reload dbus.service 2>/dev/null || true

    log "uninstalled"
}

case "${1:-install}" in
    install|"")    do_install ;;
    --uninstall)   do_uninstall ;;
    -h|--help)
        cat <<'USAGE'
Usage: install.sh [--uninstall]
USAGE
        exit 0
        ;;
    *) die "unknown argument: $1 (use --uninstall)" ;;
esac
```

- [ ] **Step 2: Make it executable**

Run: `chmod 755 tools/install-bt-rssi.sh`

- [ ] **Step 3: Syntax-check the script**

Run: `bash -n tools/install-bt-rssi.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Smoke-test the help mode (no root needed)**

Run: `tools/install-bt-rssi.sh --help`
Expected output (to stdout):
```
Usage: install.sh [--uninstall]
```

- [ ] **Step 5: Smoke-test the non-root guard**

Run (without sudo): `tools/install-bt-rssi.sh 2>&1; echo "exit=$?"`
Expected output (to stderr, followed by exit code 1):
```
[install-bt-rssi] error: must run as root (try: sudo tools/install-bt-rssi.sh)
exit=1
```

- [ ] **Step 6: Smoke-test the missing-files guard (no root, but pre-check fires first)**

The preflight checks file existence before doing anything privileged, so even without sudo we can verify this. Create a temp staging tree with no files and run the script:

Run:
```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/etc/systemd/system" "$tmp/etc/dbus-1/system.d" "$tmp/usr/local/bin" "$tmp/usr/share/dbus-1/system-services"
cp tools/install-bt-rssi.sh "$tmp/install.sh"
chmod 755 "$tmp/install.sh"
sudo "$tmp/install.sh" 2>&1; echo "exit=$?"
rm -rf "$tmp"
```
Expected: `error: must run as root (try: sudo ...)` is skipped (we used sudo), and instead one of the `missing staged ...` errors fires, exit code 1.

- [ ] **Step 7: Commit**

```bash
git add tools/install-bt-rssi.sh
git commit -m "tools: add install/uninstall script for bt-rssi service"
```

---

## Task 2: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

**Interfaces:**
- Consumes: existing `.gitignore` content.
- Produces: a `.gitignore` that excludes `services/bt-rssi/target/` (cargo build output) and `bt-rssi-*.tar.gz` (built tarball).

- [ ] **Step 1: Read the current `.gitignore`**

Run: `cat .gitignore`

- [ ] **Step 2: Append the two patterns**

Append (preserving the existing content) so the file becomes:

```
schemas/gschemas.compiled
bluetooth-smartlock@ba0f3.github.com.shell-extension.zip
services/bt-rssi/target/
bt-rssi-*.tar.gz
```

(If the existing file already has different content, add only the two new lines; do not remove or reorder existing lines. The lines above show the expected end state assuming the current file contains the first two lines.)

- [ ] **Step 3: Verify**

Run: `tail -n 5 .gitignore`
Expected last two lines:
```
services/bt-rssi/target/
bt-rssi-*.tar.gz
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore cargo target and service tarball"
```

---

## Task 3: Extend `Makefile` with service targets

**Files:**
- Modify: `Makefile`

**Interfaces:**
- Consumes: existing `Makefile` (do not touch existing targets). Requires `tools/install-bt-rssi.sh` to exist (created in Task 1) — the `service-dist` target depends on it.
- Produces:
  - `service-build` phony target — runs `cargo build --release` inside `services/bt-rssi`.
  - `service-dist` phony target — depends on `service-build` and `tools/install-bt-rssi.sh`; stages the binary, unit, two D-Bus files, and `install.sh` into a temporary directory matching the tarball layout, then `tar -czf`s it into `bt-rssi-$(SERVICE_VERSION).tar.gz` at the repo root, then removes the staging directory.
  - `SERVICE_DIR`, `SERVICE_VERSION`, `SERVICE_BIN`, `SERVICE_STAGE`, `SERVICE_TARBALL` variables.

- [ ] **Step 1: Append the additions**

Append to `Makefile` (do not modify any existing line):

```make

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
```

- [ ] **Step 2: Verify the new targets are visible**

Run: `make -n service-build && make -n service-dist`
Expected: both commands print their respective `cd ... && cargo ...` and `install ...` lines without errors, exit code 0.

- [ ] **Step 3: Verify `SERVICE_VERSION` resolves**

Run: `make -p 2>/dev/null | grep '^SERVICE_VERSION'`
Expected: a line like `SERVICE_VERSION := 0.1.0`.

- [ ] **Step 4: Build the service binary**

Run: `make service-build`
Expected: cargo finishes with `Finished 'release' profile ...` and exit code 0. Output includes lines from the `bt-rssi` crate compilation.

- [ ] **Step 5: Build the tarball**

Run: `make service-dist`
Expected: ends with `built bt-rssi-0.1.0.tar.gz` (or current version) and exit code 0.

- [ ] **Step 6: Inspect the tarball layout**

Run: `tar -tzf bt-rssi-0.1.0.tar.gz | sort`
Expected (paths exactly):
```
etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
etc/systemd/system/bt-rssi.service
install.sh
usr/local/bin/bt-rssi
usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service
```

- [ ] **Step 7: Smoke-test the staged tarball on this machine**

Run:
```bash
tmp="$(mktemp -d)"
tar -xzf bt-rssi-0.1.0.tar.gz -C "$tmp"
file "$tmp/usr/local/bin/bt-rssi"
cat "$tmp/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf" | head -3
rm -rf "$tmp"
```
Expected: `file` reports an ELF executable (Linux); the policy file's first three lines match the contents of `services/org.gnome.BluetoothRSSI.conf`.

- [ ] **Step 8: Clean up the build artifacts**

Run: `make clean && rm -f bt-rssi-0.1.0.tar.gz`
Expected: no errors, the `.tar.gz` and `schemas/gschemas.compiled` are gone. (`make clean` removes the schemas file but not the cargo target — that's intentional, leave `services/bt-rssi/target/` in place for faster rebuilds; `.gitignore` already excludes it.)

- [ ] **Step 9: Commit**

```bash
git add Makefile
git commit -m "build: add service-build and service-dist Makefile targets"
```

---

## Task 4: Create `services/README.md`

**Files:**
- Create: `services/README.md`

**Interfaces:**
- Consumes: nothing (new file).
- Produces: a single Markdown doc that any user landing on `services/` can read to understand what the service is, the D-Bus interface, the deployment layout, build, install/uninstall, and the security rationale. Sections, in order: title; "What it is / why it exists"; "D-Bus interface" (with `StartMonitoring`, `StopMonitoring`, `RSSIUpdate`, error variants); "Deployment layout" (table); "Build"; "Install / Uninstall"; "Security".

- [ ] **Step 1: Create the doc**

Create `services/README.md` with exactly this content:

````markdown
# `bt-rssi` — Bluetooth RSSI D-Bus service

This directory contains a small system D-Bus service that lets the
[GNOME Shell extension](../README.md) read RSSI values for already-paired
Bluetooth devices.

## What it is / why it exists

The extension runs inside the GNOME Shell session and cannot open the
Linux Bluetooth management socket (`HCI_CHANNEL_CONTROL`) — that requires
`CAP_NET_ADMIN`, which a session extension does not have.

`bt-rssi` is a tiny Rust service that owns that capability (granted via
the systemd unit's `AmbientCapabilities=`) and exposes a thin D-Bus
interface to the extension. RSSI queries use the management API's
`MGMT_OP_GET_CONN_INFO` against an existing ACL connection — **no
scanning, no radio activity, no disturbance to other devices**.

It was introduced in
[#18](https://github.com/ba0f3/gnome-bluetooth-smartlock/pull/18) and
fixed in [#19](https://github.com/ba0f3/gnome-bluetooth-smartlock/pull/19).

## D-Bus interface

- **Bus name:** `org.gnome.BluetoothRSSI`
- **Object path:** `/org/gnome/BluetoothRSSI`
- **Interface:** `org.gnome.BluetoothRSSI`

### Methods

| Method | In          | Out | Notes |
|--------|-------------|-----|-------|
| `StartMonitoring(address: s, interval_seconds: u, hci_index: u)` | — | returns `()` | Spawns a background task that emits `RSSIUpdate` every `interval_seconds` (minimum 1) for `address` on adapter `hci_index`. If already monitoring this address, restarts with the new interval. Returns `InvalidArgs` on a malformed MAC. Returns `LimitsExceeded` if 8 monitors are already active. |
| `StopMonitoring(address: s)` | — | returns `()` | Cancels the background task for `address`. No-op if not monitoring. |

### Signal

| Signal | Args | Notes |
|--------|------|-------|
| `RSSIUpdate(address: s, rssi: n)` | (MAC, RSSI in dBm) | Emitted for each new reading while monitoring is active. |

### Error variants

| Error | When |
|-------|------|
| `NotConnected` | The device is not currently connected — expected when it walks out of range. The extension treats this as "lock now". |
| `PermissionDenied` | The kernel refused the operation; usually means the systemd unit is missing `AmbientCapabilities=CAP_NET_ADMIN`. |
| `LimitsExceeded` | Eight monitors are already active. The cap exists so an unauthenticated local caller cannot exhaust the privileged process's resources. |
| `InvalidArgs` | Caller passed a malformed MAC address. |
| `Io`, `MgmtStatus` | Other I/O / mgmt-API errors. See source. |

## Deployment layout

| Source file                                  | Install path                                                            |
|----------------------------------------------|-------------------------------------------------------------------------|
| `target/release/bt-rssi` (built)             | `/usr/local/bin/bt-rssi`                                                |
| `bt-rssi.service`                            | `/etc/systemd/system/bt-rssi.service`                                   |
| `org.gnome.BluetoothRSSI.conf`               | `/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf`                      |
| `org.gnome.BluetoothRSSI.dbus-service`       | `/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service`     |

`org.gnome.BluetoothRSSI.service` is the file the system bus activation
looks up when a client asks for the bus name; D-Bus activation in turn
launches the systemd unit, which starts the binary.

## Build

Requires Rust 1.94 or newer.

```sh
cd bt-rssi
cargo build --release
```

Or with [pixi](https://prefix.dev/):

```sh
pixi run build
```

## Install / Uninstall

### From a release tarball (end users)

```sh
tar -xzf bt-rssi-<version>.tar.gz
sudo ./install.sh            # install
sudo ./install.sh --uninstall # remove
```

### From source (developers)

```sh
cd bt-rssi
pixi run install            # install
pixi run uninstall          # remove
```

After install, enable and start:

```sh
sudo systemctl enable --now bt-rssi.service
busctl introspect org.gnome.BluetoothRSSI /org/gnome/BluetoothRSSI
```

## Security

- **Dedicated system user.** The unit runs as user `bt-rssi`
  (`useradd --system --shell /usr/sbin/nologin`). No login, no shell.
- **Bus-name ownership restricted.** `org.gnome.BluetoothRSSI.conf`
  allows only the `bt-rssi` user to `own` the bus name, so a malicious
  local process cannot squat it and spoof RSSI values to the extension.
- **Capability bounding.** The unit sets `AmbientCapabilities=CAP_NET_ADMIN`
  and `CapabilityBoundingSet=CAP_NET_ADMIN` — that single capability is
  sufficient for `HCI_CHANNEL_CONTROL` and nothing else.
- **Monitor cap.** `MAX_MONITORS = 8` bounds the number of concurrent
  background tasks (each pins a file descriptor and periodically spawns
  a blocking HCI read), preventing an unauthenticated local caller from
  exhausting the privileged process's resources.
- **Hardening.** `ProtectSystem=strict`, `ProtectHome=true`,
  `PrivateTmp=true`, `NoNewPrivileges=true`, `RestrictSUIDSGID=true`,
  `SystemCallFilter=@system-service`, `UMask=0077`.

The service exits after 30 seconds with no active monitors; D-Bus
activation restarts it on the next `StartMonitoring` call.
````

- [ ] **Step 2: Verify the file is well-formed**

Run: `head -n 5 services/README.md && echo "---" && tail -n 5 services/README.md`
Expected: first 5 lines start with `# ` then the title block; last 5 lines end with the security bullet points and the closing paragraph.

- [ ] **Step 3: Verify all source files referenced by the doc exist**

Run:
```bash
for f in bt-rssi.service org.gnome.BluetoothRSSI.conf org.gnome.BluetoothRSSI.dbus-service bt-rssi/src/main.rs bt-rssi/src/hci.rs; do
  test -f "$f" && echo "ok   $f" || echo "MISS $f"
done
```
Expected: five `ok` lines, no `MISS`.

- [ ] **Step 4: Commit**

```bash
git add services/README.md
git commit -m "docs(services): document bt-rssi D-Bus service"
```

---

## Task 5: Update root `README.md`

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: existing root `README.md` content (must stay byte-for-byte unchanged in the sections that aren't being edited).
- Produces: a root `README.md` with:
  - A new `### Proximity locking (optional)` subsection under `## Usage`, placed after the existing `### Settings` subsection and before `## Installation`.
  - An expanded `### Install from source` section that adds one paragraph about the optional service tarball.
  - A new `## Releases` section near the end (after `### Install from source`) that links to the GitHub releases page and lists both artifacts.

- [ ] **Step 1: Add the "Proximity locking (optional)" subsection**

In `README.md`, find this exact block:

```
### Settings
```

followed by the screenshot paragraph and the `## Installation` heading. Insert a new subsection **between** the `### Settings` block and `## Installation`:

```markdown

### Proximity locking (optional)

Out of the box, the extension locks the session when the chosen device
disconnects. For finer-grained, *distance-aware* locking (lock as the
device leaves the room, not just when it disconnects) the extension
relies on RSSI values reported by a small companion D-Bus service,
[`bt-rssi`](services/README.md).

Install the service on the host once, and proximity locking kicks in
automatically — no extra configuration in the extension is required.
The disconnect-based fallback continues to work even when the service
is not installed.
```

- [ ] **Step 2: Expand "Install from source"**

Find the existing "Install from source" section. Replace its body (the bulleted "Requires:" lines and the `git clone … make install` block) with:

````markdown

### Install from source

Requires:

- git
- make
- (for proximity locking) the Rust toolchain — see
  [`services/README.md`](services/README.md)

```sh
git clone https://github.com/ba0f3/gnome-bluetooth-smartlock.git
cd gnome-bluetooth-smartlock
make install
```

Proximity locking also needs the `bt-rssi` service installed on the host.
Download the matching `bt-rssi-<version>.tar.gz` from the
[Releases](#releases) section below and run `sudo ./install.sh` from
inside the extracted tarball.
````

(Preserve the empty line above the `### Install from source` heading
and the section heading itself; replace only the body that follows the
heading.)

- [ ] **Step 3: Add a `## Releases` section**

After the `### Install from source` block (which is the last subsection
under `## Installation`), append a new top-level section:

```markdown

## Releases

Each GitHub release publishes two artifacts:

- `bluetooth-smartlock@ba0f3.github.com.shell-extension.zip` — the
  GNOME Shell extension, installable with `gnome-extensions install`.
- `bt-rssi-<version>.tar.gz` — the RSSI D-Bus service, installable
  with `sudo ./install.sh` (see [`services/README.md`](services/README.md)).

Find both at <https://github.com/ba0f3/gnome-bluetooth-smartlock/releases>.
```

- [ ] **Step 4: Sanity-check the structure**

Run: `grep -nE '^##? ' README.md`
Expected output (existing headings preserved, new ones added in the
right places):

```
1:# Bluetooth Smart Lock ...
9:## Usage
18:### Settings
26:### Proximity locking (optional)
33:## Installation
34:### Requirements
38:### Installation from extensions.gnome.org
41:### Install from source
51:## Releases
```

(The exact line numbers may shift slightly if the surrounding text
changes; the heading names and their order are what matters.)

- [ ] **Step 5: Verify the in-doc links resolve**

Run: `ls services/README.md`
Expected: the file exists (confirms the link target from `README.md`
points at a real path). The `#releases` link is internal to the same
file and resolves by construction.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: surface proximity locking and service tarball in README"
```

---

## Task 6: Update `.github/workflows/release.yml`

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: existing workflow that runs on `push` to `main` and tags matching `v*`, with steps: Checkout → Install build dependencies → Build extension package → Build and test bt-rssi service → Publish GitHub Release.
- Produces: the same workflow plus one new step (`Package bt-rssi service`) between "Build and test bt-rssi service" and "Publish GitHub Release", and an additional path argument on the `gh release create` line so the new tarball is attached as a second asset.

- [ ] **Step 1: Add the "Package bt-rssi service" step**

Insert this step immediately after the existing "Build and test bt-rssi service" step and before "Publish GitHub Release":

```yaml
      - name: Package bt-rssi service
        run: make service-dist
```

(Indent with six spaces so it lines up with the existing `- name:`
entries.)

- [ ] **Step 2: Update the "Publish GitHub Release" step**

Replace the existing `gh release create ...` command's trailing lines
so the step body becomes:

```yaml
      # Use gh instead of a third-party action so local `act` does not need to git-clone actions (avoids host GitHub auth issues).
      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh --version >/dev/null 2>&1 || {
            sudo apt-get update
            sudo DEBIAN_FRONTEND=noninteractive apt-get install -y gh
          }
          gh release create "${{ github.ref_name }}" \
            bluetooth-smartlock@ba0f3.github.com.shell-extension.zip \
            bt-rssi-*.tar.gz \
            --generate-notes
```

The only changes from the existing step are:
1. A second path (`bt-rssi-*.tar.gz`) on the `gh release create`
   command, on its own line.

- [ ] **Step 3: Validate the YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('ok')"`
Expected: `ok` and exit code 0. (Requires Python 3; if unavailable,
skip this step and rely on `act run` or pushing to a branch to validate.)

- [ ] **Step 4: Verify the `bt-rssi-*.tar.gz` glob matches what `make service-dist` produces**

Run: `make service-dist >/dev/null && ls bt-rssi-*.tar.gz && rm -f bt-rssi-*.tar.gz`
Expected: a single `bt-rssi-<version>.tar.gz` file is listed (the glob
matches exactly one path).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build and attach bt-rssi service tarball to release"
```

---

## Task 7: End-to-end verification

**Files:**
- Modify: none (verification only)

**Interfaces:**
- Consumes: every artifact produced by Tasks 1–6.
- Produces: a verified clean state where: `make service-build` succeeds; `make service-dist` succeeds and produces a tarball with the expected layout; `make` (the existing default target) still succeeds; `npx eslint *.js bluetooth/*.js` is unaffected by these changes (no `.js` files were edited).

- [ ] **Step 1: Confirm `make` (the extension) still builds**

Run: `make`
Expected: exit code 0; no errors; `schemas/gschemas.compiled` is regenerated (if `glib-compile-schemas` is installed) or `make` reports nothing to do (both are acceptable).

- [ ] **Step 2: Confirm lint is clean (no JS files were touched, but assert nothing regressed)**

Run: `npx eslint *.js bluetooth/*.js`
Expected: exit code 0, no output. If `npx`/`eslint` are not installed, skip and note in the PR description.

- [ ] **Step 3: Confirm the service tarball builds end-to-end**

Run:
```bash
make service-dist
tar -tzf bt-rssi-*.tar.gz | sort
rm -f bt-rssi-*.tar.gz
```
Expected tarball entries (sorted):
```
etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
etc/systemd/system/bt-rssi.service
install.sh
usr/local/bin/bt-rssi
usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service
```

- [ ] **Step 4: Confirm install.sh round-trips on a throwaway staging tree**

Run:
```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/etc/systemd/system" "$tmp/etc/dbus-1/system.d" "$tmp/usr/local/bin" "$tmp/usr/share/dbus-1/system-services"
touch "$tmp/usr/local/bin/bt-rssi" \
      "$tmp/etc/systemd/system/bt-rssi.service" \
      "$tmp/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf" \
      "$tmp/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service"
cp tools/install-bt-rssi.sh "$tmp/install.sh"
chmod 755 "$tmp/install.sh"
bash -n "$tmp/install.sh"
sudo "$tmp/install.sh" 2>&1 | tail -n 5 || true
sudo "$tmp/install.sh" --uninstall 2>&1 | tail -n 3 || true
rm -rf "$tmp"
```
Expected: `bash -n` exits 0; install output includes the `installed` log line and the `enable and start with:` hint; uninstall output includes the `uninstalled` log line. (The actual `install`/`rm`/`systemctl` calls may fail on a non-systemd host — that's why we tolerate failure and only check the log lines.)

- [ ] **Step 5: Inspect the final diff**

Run: `git log --oneline -10` and `git status`
Expected: `git status` is clean (no uncommitted changes); `git log` shows the new commits for Tasks 1–6 at the tip, on top of `e6611a6` (the spec commit).

- [ ] **Step 6: No commit (verification only)**

This task produces no commit. If any verification step fails, fix the
underlying issue and commit a fix before declaring the work done.
