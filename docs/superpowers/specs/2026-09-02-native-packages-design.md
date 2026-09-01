# Native Packages (`.deb` + `.rpm`) for `bt-rssi`

**Date:** 2026-09-02
**Status:** Draft — awaiting user approval

## Problem

Today the only release artifact for the `bt-rssi` service is a tarball
that the user has to download, extract, and run `install.sh` on. This
works, but Debian/Ubuntu and Fedora/RHEL users expect a native package
they can install with their distro's package manager:

- Files go to FHS-correct paths (`/usr/bin/`, `/usr/lib/systemd/system/`).
- The package manager handles dependencies and tracks the install for
  clean uninstall.
- Post-install hooks can `systemctl daemon-reload`, reload `dbus.service`,
  and enable + start the service automatically.
- Users get one command (`apt install` / `dnf install`) instead of a
  download-then-extract-then-run-script flow.

The misconception worth flagging up front: **packages attached to a
GitHub release are not "auto-install"**. The user still has to
download the `.deb` / `.rpm` and run `sudo apt install ./bt-rssi_*.deb`
or `sudo dnf install ./bt-rssi-*.rpm`. True zero-effort install
("`apt install bt-rssi` works out of the box") requires a proper
distro repository with GPG signing and hosted metadata — that is
explicitly out of scope here.

## Goals

- Produce a `.deb` and a `.rpm` of `bt-rssi` for `x86_64-unknown-linux-gnu`
  on every release, alongside the existing tarball.
- Place files at FHS-correct paths when installed via package.
- Auto-enable and start the `bt-rssi.service` unit on package install
  (matches the convention for system service packages: nginx, postgresql,
  docker, etc.).
- Make install + uninstall clean: pre-removal disables the service,
  post-removal reloads `dbus.service` and `systemctl daemon-reload`.
- Attach the new artifacts to the existing GitHub Release alongside
  the extension zip and the service tarball.
- Document the four install paths in `services/README.md` and
  root `README.md`.

## Non-goals

- No distro repository, no GPG signing, no `apt`/`dnf` repo hosting.
- No ARM / aarch64 build matrix expansion (single-arch `x86_64` is
  enough for the initial rollout; cross-compile later if requested).
- No replacement of `install.sh` or the tarball. They remain for users
  on distros not covered by `.deb` / `.rpm` (Arch, Nix, Gentoo, source
  builds, etc.).
- No changes to the `bt-rssi` Rust source or its D-Bus interface.

## Design

### 1. Tooling

`cargo-deb` and `cargo-rpm` — the standard Rust-native packagers. Both
read metadata directly from `services/bt-rssi/Cargo.toml`, so the
packaging config lives with the code it packages (no separate `.spec`
or `debian/` tree to maintain).

- `cargo-deb` → produces
  `services/bt-rssi/target/debian/bt-rssi_<version>_<arch>.deb`.
- `cargo-rpm` → produces
  `services/bt-rssi/target/generate-rpm/bt-rssi-<version>-1.<arch>.rpm`.

Both install via `cargo install cargo-deb cargo-rpm`. The Ubuntu
runner already has `cargo`; we add `dpkg-dev` and `rpm` to the apt
install list in CI.

### 2. Asset mapping

The package installs files at FHS-correct paths, **diverging from
`install.sh`** which uses `/usr/local/bin/` and `/etc/systemd/system/`.
Both paths are conventional in their context; the divergence is
intentional and documented in `services/README.md`.

| Source                                         | `.deb` / `.rpm` install path                              | `install.sh` (tarball) install path                      |
|------------------------------------------------|-----------------------------------------------------------|----------------------------------------------------------|
| `target/release/bt-rssi`                       | `/usr/bin/bt-rssi`                                        | `/usr/local/bin/bt-rssi`                                 |
| `services/bt-rssi.service`                     | `/usr/lib/systemd/system/bt-rssi.service` (vendor)        | `/etc/systemd/system/bt-rssi.service` (admin override)   |
| `services/org.gnome.BluetoothRSSI.conf`        | `/etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf`       | same                                                     |
| `services/org.gnome.BluetoothRSSI.dbus-service`| `/usr/share/dbus-1/system-services/org.gnome.BluetoothRSSI.service` | same                                |

Rationale:

- `/usr/bin/` for the binary is FHS; `/usr/local/bin/` is for
  locally-built software outside the package manager. Each path is
  correct for its install method.
- `/usr/lib/systemd/system/` is the vendor directory; packages install
  here so admin overrides in `/etc/systemd/system/` continue to work.
  `install.sh` writes to `/etc/systemd/system/` because there's no
  package manager to enforce the convention.
- The two D-Bus files have only one correct path on every distro.

### 3. `services/bt-rssi/Cargo.toml` additions

Append two metadata blocks. The `[package]` section is unchanged.

```toml
[package.metadata.deb]
maintainer            = "ba0f3 <noreply@github.com>"
copyright             = "2026, ba0f3"
license-file          = ["../../LICENSE", "0"]
depends               = ["$auto", "systemd", "dbus"]
section               = "net"
priority              = "optional"
extended-description  = """\
Bluetooth RSSI D-Bus service for gnome-bluetooth-smartlock. Exposes
org.gnome.BluetoothRSSI on the system bus so the GNOME Shell extension
can read RSSI values for already-paired Bluetooth devices. Requires
CAP_NET_ADMIN (granted by the bundled systemd unit).\
"""
assets = [
    ["target/release/bt-rssi",                                  "usr/bin/bt-rssi",                                              "755"],
    ["../../services/bt-rssi.service",                           "lib/systemd/system/bt-rssi.service",                           "644"],
    ["../../services/org.gnome.BluetoothRSSI.conf",              "etc/dbus-1/system.d/org.gnome.BluetoothRSSI.conf",             "644"],
    ["../../services/org.gnome.BluetoothRSSI.dbus-service",      "share/dbus-1/system-services/org.gnome.BluetoothRSSI.service", "644"],
]

[package.metadata.rpm]
spec = "rpm/bt-rssi.spec"
```

The `[package.metadata.rpm]` block is intentionally minimal — it
points `cargo rpm build` at our custom spec, which is the source of
truth for file lists, hooks, and dependencies. cargo-rpm will not
generate a spec from metadata when `spec` is set.

### 4. Post-install behavior

**`.deb` postinst** (lives at
`services/bt-rssi/debian/postinst`, picked up by `cargo deb`):

```sh
#!/bin/sh
set -e
systemctl daemon-reload
systemctl reload dbus.service 2>/dev/null || true
if [ -d /run/systemd/system ]; then
    systemctl enable bt-rssi.service  >/dev/null 2>&1 || true
    systemctl restart bt-rssi.service >/dev/null 2>&1 || true
fi
```

**`.deb` prerm** (`services/bt-rssi/debian/prerm`):

```sh
#!/bin/sh
set -e
if [ -d /run/systemd/system ]; then
    systemctl disable --now bt-rssi.service 2>/dev/null || true
fi
```

**`.rpm` `%post` / `%preun` / `%postun`** in
`services/bt-rssi/rpm/bt-rssi.spec`:

```spec
%post
%systemd_post bt-rssi.service
systemctl reload dbus.service 2>/dev/null || :

%preun
%systemd_preun bt-rssi.service

%postun
%systemd_postun_with_restart bt-rssi.service
systemctl reload dbus.service 2>/dev/null || :
```

Both Debian and RPM conventions tolerate the `dbus.service` reload
failing (some distros don't expose it as a unit); the `2>/dev/null ||
true` (Debian) / `|| :` (RPM) guards keep the postinst non-fatal.

`install.sh` stays non-auto-enable. The two paths have different
defaults because they target different audiences: tarball users are
explicitly invoking a script (cautious); package users are running
through their distro's installer (expecting things to work).

### 5. `Makefile` additions

Append (do not modify existing targets):

```make
SERVICE_DEB := $(SERVICE_DIR)/target/debian/bt-rssi_$(SERVICE_VERSION)_amd64.deb

.PHONY: service-package-deb service-package-rpm service-package

service-package-deb: service-build
	cd $(SERVICE_DIR) && cargo deb

service-package-rpm: service-build
	cd $(SERVICE_DIR) && cargo rpm build

service-package: service-package-deb service-package-rpm
```

The RPM target path is intentionally not pinned — `cargo rpm build`
writes to `target/generate-rpm/...` with a path that depends on the
host architecture. The CI step that locates the artifact globs for it.

### 6. CI workflow updates

Insert two new steps after the existing "Package bt-rssi service"
step and before "Publish GitHub Release":

```yaml
      - name: Install cargo packagers
        run: |
          sudo apt-get update
          sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
            -o Dpkg::Options::="--force-confdef" \
            -o Dpkg::Options::="--force-confold" \
            dpkg-dev rpm
          cargo install cargo-deb cargo-rpm

      - name: Build .deb and .rpm
        run: make service-package

      - name: Locate package artifacts
        id: pkg
        run: |
          echo "deb=$(ls services/bt-rssi/target/debian/*.deb)" \
               >> "$GITHUB_OUTPUT"
          echo "rpm=$(find services/bt-rssi/target/generate-rpm -name '*.rpm' | head -n1)" \
               >> "$GITHUB_OUTPUT"
```

Update the "Publish GitHub Release" step's `gh release create` line to
include the two new artifacts:

```yaml
          gh release create "${{ github.ref_name }}" \
            bluetooth-smartlock@ba0f3.github.com.shell-extension.zip \
            bt-rssi-*.tar.gz \
            ${{ steps.pkg.outputs.deb }} \
            ${{ steps.pkg.outputs.rpm }} \
            --generate-notes
```

### 7. Docs updates

**`services/README.md`** adds a "Native packages" subsection between
"Build" and "Install / Uninstall":

````markdown
### Native packages (Debian / Ubuntu / Fedora / RHEL)

```sh
# Debian / Ubuntu
sudo apt install ./bt-rssi_<version>_amd64.deb

# Fedora / RHEL
sudo dnf install ./bt-rssi-<version>-1.<arch>.rpm
```

The package installs the binary to `/usr/bin/`, the systemd unit to
`/usr/lib/systemd/system/`, and the D-Bus files to their canonical
paths. Post-install hooks enable and start `bt-rssi.service`.

For non-Debian / non-RHEL distros, or when you want the install
location to be `/usr/local/` and `/etc/systemd/system/`, use the
tarball + `install.sh` path below instead.
````

**Root `README.md`** — update the proximity-locking install blurb to
mention packages:

```markdown
Proximity locking also needs the `bt-rssi` service installed on the host.
Download the matching `.deb` (Debian/Ubuntu) or `.rpm`
(Fedora/RHEL) from the [Releases](#releases) section below and install
with `sudo apt install ./bt-rssi_*.deb` (or `dnf` for RPM). The tarball
+ `install.sh` path is the fallback for other distros.
```

Update the `## Releases` section to list all four artifacts:

```markdown
Each GitHub release publishes four artifacts:

- `bluetooth-smartlock@ba0f3.github.com.shell-extension.zip` — the
  GNOME Shell extension, installable with `gnome-extensions install`.
- `bt-rssi-<version>.tar.gz` — the RSSI D-Bus service, installable
  with `sudo ./install.sh` (see [`services/README.md`](services/README.md)).
- `bt-rssi-<version>_amd64.deb` — Debian / Ubuntu package,
  installable with `sudo apt install ./<file>.deb`.
- `bt-rssi-<version>-1.<arch>.rpm` — Fedora / RHEL package,
  installable with `sudo dnf install ./<file>.rpm`.

Find all of them at
<https://github.com/ba0f3/gnome-bluetooth-smartlock/releases>.
```

## Component Summary

| Component                              | Type     | Purpose                                                       |
|----------------------------------------|----------|---------------------------------------------------------------|
| `services/bt-rssi/Cargo.toml`          | update   | Add `[package.metadata.deb]` and `[package.metadata.rpm]` blocks |
| `services/bt-rssi/debian/postinst`     | new      | `.deb` post-install hook (daemon-reload, enable, restart)     |
| `services/bt-rssi/debian/prerm`        | new      | `.deb` pre-removal hook (disable + stop service)              |
| `services/bt-rssi/rpm/bt-rssi.spec`    | new      | `.rpm` spec template with `%post` / `%preun` / `%postun` hooks |
| `Makefile`                             | append   | `service-package-deb`, `service-package-rpm`, `service-package` |
| `.github/workflows/release.yml`        | update   | Install packagers, build packages, attach to release          |
| `services/README.md`                   | update   | Native packages install section, FHS path table               |
| `README.md`                            | update   | Install blurb mentions packages; `Releases` lists 4 artifacts |

## Data Flow

Unchanged from the existing spec
(`docs/superpowers/specs/2026-09-02-services-docs-and-deploy-design.md`).
Packages only change *how the binary gets onto disk*, not what it does.

## Error Handling

- `cargo deb` failures fail the CI step (non-zero exit).
- `cargo rpm build` failures fail the CI step.
- Post-install hook failures are non-fatal: `dbus.service` may not be
  a unit on every distro, and we explicitly tolerate that. A failure
  to enable the service is also tolerated — the user can re-run
  `systemctl enable --now bt-rssi.service` manually.
- Pre-removal hook failures are non-fatal for the same reason: we want
  the package to uninstall cleanly even if the service is in a weird
  state.

## Testing / Verification

CI:

- `cargo deb` and `cargo rpm build` both run on every push and tag.
- Artifact presence in the release is verifiable by `gh release view`.

Manual smoke (the plan will include the commands, the operator runs them
on a Linux box):

1. `make service-package` (or the equivalent `cargo deb` / `cargo rpm
   build` invocations) succeeds and produces two artifacts.
2. On a Debian/Ubuntu VM: `sudo apt install ./bt-rssi_*.deb` →
   `systemctl status bt-rssi.service` shows the service active;
   `busctl introspect org.gnome.BluetoothRSSI /org/gnome/BluetoothRSSI`
   shows the interface.
3. `sudo apt remove bt-rssi` → service is stopped, files are removed.
4. Same on a Fedora/RHEL VM with `dnf` instead of `apt`.
5. `gh release view <tag>` for a tagged release shows four artifacts.

No new automated tests are added — packaging is build-time glue and
the underlying service tests already exist in the Rust crate.

## Rollout

Single PR. No migration steps for existing users — the tarball +
`install.sh` path keeps working exactly as today. Users who want
package-manager install get two new commands.
