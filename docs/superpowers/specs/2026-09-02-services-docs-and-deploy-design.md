# Documentation + Service Deploy for `gnome-bluetooth-smartlock`

**Date:** 2026-09-02
**Status:** Draft — awaiting user approval

## Problem

The repo gained a new `services/` directory containing a Rust D-Bus service
(`bt-rssi`) that exposes `org.gnome.BluetoothRSSI` on the system bus. The
service is required for RSSI-based proximity locking — the extension runs in
the GNOME Shell session and cannot open HCI management sockets, which need
`CAP_NET_ADMIN`.

Three gaps block users from actually using the new feature:

1. **Docs.** No `services/README.md`. The root `README.md` does not mention
   proximity locking or the service. `AGENTS.md` does not list `services/` at
   all.
2. **Makefile.** `dist` only packages the GNOME extension via
   `gnome-extensions pack`. The service has no equivalent `dist` target, so
   there is no end-user-shippable artifact.
3. **CI.** `.github/workflows/release.yml` builds and tests the service but
   produces no artifact and uploads nothing for it to the GitHub Release.

The only deploy path that exists today is `pixi run install` in
`services/bt-rssi/pixi.toml`, which requires `pixi` on the host and is
intended for development.

## Goals

- Make the service discoverable: a user landing on the repo or a GitHub
  Release can understand what the service is, why it exists, how to install
  it, and how to uninstall it.
- Produce a release artifact for the service that mirrors the existing
  `.shell-extension.zip` for the extension: a self-contained, platform-correct
  tarball that installs with one command.
- Attach the service artifact to the GitHub Release alongside the extension
  zip so a single release publishes both.
- Keep the diff minimal: no Rust source changes, no refactors, no new repo,
  no new build-system dependency (`cargo` + `tar` are already available).

## Non-goals

- Repackaging as `.deb` / `.rpm` (deferred; can be layered on later).
- Splitting the service into its own repo.
- Updating `AGENTS.md` / `CLAUDE.md` (a separate fix is needed for the
  GNOME 48–50 vs 46–50 drift, but it's out of scope here).
- Changing the service code or its D-Bus interface.

## Design

### 1. `services/README.md` (new)

Single doc covering everything in `services/`. Sections:

- **What it is / why it exists** — one paragraph: GNOME Shell session
  extensions cannot open HCI management sockets (need `CAP_NET_ADMIN`), so a
  small system D-Bus service with that capability bridges the extension to
  the kernel Bluetooth mgmt API. Links to the originating PR (#18) and the
  follow-up fix (#19).
- **D-Bus interface** — name `org.gnome.BluetoothRSSI`, object path
  `/org/gnome/BluetoothRSSI`:
  - `StartMonitoring(address: s, interval_seconds: u, hci_index: u) → ()` —
    spawns a background task that emits `RSSIUpdate` every `interval_seconds`
    for the given Bluetooth address on the given adapter. Validates the
    address format before doing any work. Returns `InvalidArgs` on malformed
    addresses, `LimitsExceeded` if `MAX_MONITORS = 8` is reached.
  - `StopMonitoring(address: s) → ()` — cancels the corresponding background
    task. No-op if not monitoring.
  - `RSSIUpdate(address: s, rssi: n)` signal — emitted for each new reading.
  - Error variants a caller may see: `NotConnected`, `PermissionDenied`,
    `LimitsExceeded`, `InvalidArgs`, `Io`, `MgmtStatus`.
- **Deployment layout** — table mapping each source file to its installed
  path (binary → `/usr/local/bin/bt-rssi`; systemd unit → `/etc/systemd/system/bt-rssi.service`;
  D-Bus policy → `/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf`;
  D-Bus activation → `/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service`).
- **Build** — `cargo build --release` (or `pixi run build`).
- **Install / uninstall**:
  - From source: `pixi run install` / `pixi run uninstall`.
  - From release tarball: extract, then `sudo ./install.sh` or
    `sudo ./install.sh --uninstall`.
- **Security** — why the dedicated `bt-rssi` system user, why the D-Bus
  policy restricts `own` to that user (prevents squatting/spoofing), why
  `AmbientCapabilities=CAP_NET_ADMIN` is the only granted capability (HCI
  mgmt channel), and the `MAX_MONITORS = 8` cap that prevents an
  unauthenticated local user from exhausting the privileged process.

### 2. Root `README.md` (update)

Add:

- A **"Proximity locking (optional)"** subsection under "Usage" explaining
  that the disconnect-based lock works out of the box, but RSSI-based
  proximity locking requires the `bt-rssi` service installed on the host,
  with a link to `services/README.md`.
- An **"Installation"** subsection note: install the GNOME extension as
  before; for proximity locking additionally install the matching
  `bt-rssi-<version>.tar.gz` from the same GitHub release.
- A **"Releases"** line near the install section pointing to the GitHub
  releases page where both artifacts (extension zip, service tarball) live.

No changes to the existing screenshots, settings section, or
extensions.gnome.org install path.

### 3. `Makefile` additions

Append to the existing file (do not refactor the existing `dist` /
`install` / `dev` targets):

```make
SERVICE_DIR     := services/bt-rssi
SERVICE_VERSION := $(shell awk -F'"' '/^version/ {print $$2; exit}' $(SERVICE_DIR)/Cargo.toml)
SERVICE_BIN     := $(SERVICE_DIR)/target/release/bt-rssi
SERVICE_STAGE   := $(CURDIR)/bt-rssi-$(SERVICE_VERSION)
SERVICE_TARBALL := bt-rssi-$(SERVICE_VERSION).tar.gz

service-build:
	cd $(SERVICE_DIR) && cargo build --release

service-dist: service-build
	rm -rf $(SERVICE_STAGE) $(SERVICE_TARBALL)
	mkdir -p $(SERVICE_STAGE)
	install -Dm755 $(SERVICE_BIN)               $(SERVICE_STAGE)/usr/local/bin/bt-rssi
	install -Dm644 $(CURDIR)/services/bt-rssi.service                       \
	         $(SERVICE_STAGE)/etc/systemd/system/bt-rssi.service
	install -Dm644 $(CURDIR)/services/org.gnome.BluetoothRSSI.conf         \
	         $(SERVICE_STAGE)/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
	install -Dm644 $(CURDIR)/services/org.gnome.BluetoothRSSI.dbus-service \
	         $(SERVICE_STAGE)/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service
	install -Dm755 $(CURDIR)/tools/install-bt-rssi.sh                      \
	         $(SERVICE_STAGE)/install.sh
	tar -C $(SERVICE_STAGE) -czf $(SERVICE_TARBALL) .
	rm -rf $(SERVICE_STAGE)
```

`all:` is left unchanged — `make` alone still builds the extension. The
service target chain is independent so existing user muscle memory (`make
install`) is preserved.

`.gitignore` additions:

```
services/bt-rssi/target/
bt-rssi-*.tar.gz
```

### 4. `tools/install-bt-rssi.sh` (new)

Bash script. Default mode installs; `--uninstall` reverses. Mirrors the
pixi tasks in `services/bt-rssi/pixi.toml`.

Install:

1. `id -u bt-rssi || useradd --system --shell /usr/sbin/nologin bt-rssi`
   (idempotent — `|| true`).
2. `install -Dm755` binary to `/usr/local/bin/bt-rssi`.
3. `install -Dm644` systemd unit, D-Bus policy, D-Bus activation file to
   the paths in section 3.
4. `systemctl daemon-reload`.
5. `systemctl reload dbus.service` (no-op on distros without that unit;
   tolerate failure).

Uninstall (`--uninstall`):

1. `systemctl disable --now bt-rssi.service || true`.
2. Remove the four installed files.
3. `userdel bt-rssi || true`.
4. `systemctl daemon-reload`.
5. `systemctl reload dbus.service || true`.

Set `-euo pipefail` at the top. Require root via `EUID` check at the
top, exit with a clear message if not.

### 5. `.github/workflows/release.yml` (update)

After the existing "Build and test bt-rssi service" step, add:

```yaml
- name: Package bt-rssi service
  run: make service-dist
```

Update the existing "Publish GitHub Release" step to attach the new
tarball:

```yaml
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

No new system dependencies — `cargo`, `tar`, and `gh` are all already
present on `ubuntu-latest` or installed by existing steps.

## Component Summary

| Component                 | Type      | Purpose                                                    |
| ------------------------- | --------- | ---------------------------------------------------------- |
| `services/README.md`      | new       | Service docs: why, D-Bus interface, install, security      |
| `README.md`               | update    | Surface proximity locking and the new release artifact     |
| `Makefile`                | append    | `service-build`, `service-dist` targets                    |
| `tools/install-bt-rssi.sh`| new       | End-user install/uninstall script                          |
| `.github/workflows/release.yml` | update | Build + attach service tarball to release           |
| `.gitignore`              | append    | Exclude cargo `target/` and built tarball                  |

## Data Flow (existing — documented, not changed)

1. GNOME Shell extension user picks a paired device.
2. Extension calls `StartMonitoring(address, interval, hci_index)` on
   `org.gnome.BluetoothRSSI` via `Gio.DBus.system`.
3. Service spawns a tokio task that periodically issues
   `MGMT_OP_GET_CONN_INFO` on `HCI_CHANNEL_CONTROL` (requires
   `CAP_NET_ADMIN` granted via systemd unit).
4. Service emits `RSSIUpdate(address, rssi)` signal back to the extension.
5. Extension translates RSSI into proximity state and locks/unlocks with
   the existing screen-shield path.

## Error Handling

Documented in `services/README.md`:

- `NotConnected` — expected when phone walks out of range; extension
  treats this as "lock now".
- `PermissionDenied` — `AmbientCapabilities` missing from the unit;
  docs tell the operator where to look.
- `LimitsExceeded` — caller asked to monitor too many devices; docs
  explain the cap exists to bound the privileged process's resource
  use.
- Service crash / restart — `Restart=on-failure` in the unit; extension
  re-subscribes on its next session start (existing behavior).

The install script fails loudly if not run as root. The Makefile target
fails loudly if `cargo build` fails.

## Testing / Verification

Manual:

1. `make service-build` — produces `services/bt-rssi/target/release/bt-rssi`.
2. `make service-dist` — produces `bt-rssi-0.1.0.tar.gz` (or current
   `Cargo.toml` version) with the layout above; verify contents with
   `tar -tzf`.
3. Extract on a Linux box and run `sudo ./install.sh`; verify
   `systemctl status bt-rssi.service` shows it active and
   `busctl introspect org.gnome.BluetoothRSSI /org/gnome/BluetoothRSSI`
   shows the interface.
4. `sudo ./install.sh --uninstall`; verify all four files are gone and
   the user is removed.
5. Inspect the GitHub Release artifacts for a tagged `v*` push; both
   the extension zip and the service tarball must be attached.

CI:

- Existing `cargo test` continues to run; no new test targets.
- The new `make service-dist` step is the verification that the
  Makefile additions are syntactically and functionally correct.

No new automated tests are added — the change is documentation,
packaging, and CI glue, and the underlying service tests already exist
in the Rust crate.

## Rollout

Single PR. No migration steps for existing users — they keep using the
extension as today and only need the service if they want proximity
locking.
