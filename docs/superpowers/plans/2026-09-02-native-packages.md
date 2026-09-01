# Native Packages (`.deb` + `.rpm`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cargo-deb` and `cargo-rpm` packaging for `bt-rssi`, attach the resulting `.deb` and `.rpm` to every GitHub Release alongside the existing tarball and extension zip.

**Architecture:** Metadata-driven — `[package.metadata.deb]` in `services/bt-rssi/Cargo.toml` plus a custom `.spec` at `services/bt-rssi/rpm/bt-rssi.spec` for RPM. New Makefile targets (`service-package-deb`, `service-package-rpm`, `service-package`) invoke `cargo deb` / `cargo rpm build` after the existing `service-build`. CI installs the packagers, builds both packages on every push / `v*` tag, and attaches all four artifacts to the release.

**Tech Stack:** `cargo-deb` v2.x, `cargo-rpm` v2.x, `dpkg-dev` + `rpm` (Ubuntu apt packages), existing GitHub Actions + `gh` release tooling.

## Global Constraints

From the spec — every task's requirements implicitly include these:

- Do not modify any file under `services/bt-rssi/src/` or any of the existing target files in `Makefile` (`all`, `translate`, `build`, `dist`, `install`, `dev`, `clean`, `service-build`, `service-dist`); only append new targets.
- All user-facing strings in English.
- All commits use imperative-mood subject lines, ≤72 chars, scoped to one logical change.
- `.deb` installs files at FHS paths (`/usr/bin/`, `/usr/lib/systemd/system/`, `/etc/dbus-1/system.d/`, `/usr/share/dbus-1/system-services/`). `.rpm` mirrors the same paths.
- `install.sh` continues to install at `/usr/local/bin/` + `/etc/systemd/system/` and stays non-auto-enable. Divergence is intentional and documented in `services/README.md`.
- `.deb` postinst auto-enables + starts the service. `.rpm` `%post` does the same. Pre-removal disables + stops.
- No changes to the Rust source or D-Bus interface.
- No new git history on `main` past `0bcb5f3` — this work lands on the same branch.
- CI verification (Ubuntu runner) is canonical for `cargo deb` / `cargo rpm build`; local macOS verification of those commands is impossible (Linux-only libc constants in `services/bt-rssi/src/hci.rs`).

## File Structure

**New files**
- `services/bt-rssi/debian/postinst` — `.deb` post-install hook
- `services/bt-rssi/debian/prerm` — `.deb` pre-removal hook
- `services/bt-rssi/rpm/bt-rssi.spec` — `.rpm` custom spec

**Modified files**
- `services/bt-rssi/Cargo.toml` — append `[package.metadata.deb]` and `[package.metadata.rpm]`
- `Makefile` — append `service-package-deb`, `service-package-rpm`, `service-package` targets
- `.github/workflows/release.yml` — install packagers, build packages, attach to release
- `services/README.md` — Native packages subsection + FHS path table
- `README.md` — Install blurb mentions packages; `Releases` lists 4 artifacts

## Task Index

- Task 1: Add `[package.metadata.deb]` and `[package.metadata.rpm]` to `services/bt-rssi/Cargo.toml`
- Task 2: Create `services/bt-rssi/debian/postinst` and `prerm`
- Task 3: Create `services/bt-rssi/rpm/bt-rssi.spec`
- Task 4: Add Makefile targets
- Task 5: Update CI workflow
- Task 6: Update `services/README.md`
- Task 7: Update root `README.md`
- Task 8: End-to-end verification

---

## Task 1: Add `[package.metadata.deb]` and `[package.metadata.rpm]` to `services/bt-rssi/Cargo.toml`

**Files:**
- Modify: `services/bt-rssi/Cargo.toml` (append only; do not touch the existing `[package]`, `[bin]`, or `[dependencies]` sections)

**Interfaces:**
- Consumes: the existing `services/bt-rssi/Cargo.toml` `[package]` block — `name = "bt-rssi"`, `version = "0.1.0"`, `edition = "2024"`.
- Produces: two new metadata blocks. `[package.metadata.deb]` tells `cargo deb` how to package (assets, depends, maintainer, extended description). `[package.metadata.rpm]` is minimal — it just points `cargo rpm build` at our custom spec file. Both must be syntactically valid TOML.

- [ ] **Step 1: Read the current Cargo.toml**

Run: `cat services/bt-rssi/Cargo.toml`

- [ ] **Step 2: Append the two metadata blocks**

Append (do not modify any existing line) so the file ends with the two blocks below the existing `[dependencies]` block:

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

- [ ] **Step 3: Validate TOML syntax**

Run: `python3 -c "import tomllib; tomllib.loads(open('services/bt-rssi/Cargo.toml').read()); print('toml-ok')"`
Expected: `toml-ok`, exit code 0. (Python 3.11+ ships `tomllib`; on older Python use `pip install --user toml` then `python3 -c "import toml; toml.loads(open('services/bt-rssi/Cargo.toml').read()); print('toml-ok')"`.)

- [ ] **Step 4: Verify `cargo metadata` accepts the file**

Run: `cd services/bt-rssi && cargo metadata --no-deps --format-version 1 | python3 -c "import sys, json; m = json.load(sys.stdin); print('cargo-metadata-ok, name=', m['packages'][0]['name'])"`
Expected: `cargo-metadata-ok, name= bt-rssi`, exit code 0. (On macOS this command will fail because the Linux-only libc constants in `hci.rs` block compilation; CI is the canonical check. Skip on macOS if it fails for compilation reasons — the TOML itself is still valid.)

- [ ] **Step 5: Commit**

```bash
git add services/bt-rssi/Cargo.toml
git commit -m "build(services): add cargo-deb and cargo-rpm metadata"
```

---

## Task 2: Create `services/bt-rssi/debian/postinst` and `prerm`

**Files:**
- Create: `services/bt-rssi/debian/postinst` (executable, `chmod 755`)
- Create: `services/bt-rssi/debian/prerm` (executable, `chmod 755`)

**Interfaces:**
- Consumes: nothing (cargo-deb picks these up by convention from `services/bt-rssi/debian/`).
- Produces:
  - `postinst` runs after `.deb` install. Calls `systemctl daemon-reload`, reloads `dbus.service` (tolerates failure), and if systemd is the init system, enables + restarts `bt-rssi.service`.
  - `prerm` runs before `.deb` removal. If systemd is the init system, disables + stops `bt-rssi.service`. Tolerates failure.

- [ ] **Step 1: Create the directory**

Run: `mkdir -p services/bt-rssi/debian`

- [ ] **Step 2: Write `postinst`**

Create `services/bt-rssi/debian/postinst` with exactly this content:

```sh
#!/bin/sh
set -e

systemctl daemon-reload
systemctl reload dbus.service 2>/dev/null || true

if [ -d /run/systemd/system ]; then
    systemctl enable bt-rssi.service  >/dev/null 2>&1 || true
    systemctl restart bt-rssi.service >/dev/null 2>&1 || true
fi

exit 0
```

- [ ] **Step 3: Write `prerm`**

Create `services/bt-rssi/debian/prerm` with exactly this content:

```sh
#!/bin/sh
set -e

if [ -d /run/systemd/system ]; then
    systemctl disable --now bt-rssi.service 2>/dev/null || true
fi

exit 0
```

- [ ] **Step 4: Make both executable**

Run: `chmod 755 services/bt-rssi/debian/postinst services/bt-rssi/debian/prerm`

- [ ] **Step 5: Syntax-check both scripts**

Run: `bash -n services/bt-rssi/debian/postinst && bash -n services/bt-rssi/debian/prerm && echo "syntax-ok"`
Expected: `syntax-ok`, exit code 0.

- [ ] **Step 6: Verify file modes**

Run: `ls -l services/bt-rssi/debian/`
Expected: both files listed as `-rwxr-xr-x`.

- [ ] **Step 7: Commit**

```bash
git add services/bt-rssi/debian/postinst services/bt-rssi/debian/prerm
git commit -m "build(services): add debian postinst and prerm hooks"
```

---

## Task 3: Create `services/bt-rssi/rpm/bt-rssi.spec`

**Files:**
- Create: `services/bt-rssi/rpm/bt-rssi.spec`

**Interfaces:**
- Consumes: nothing (cargo-rpm reads this file when `spec = "rpm/bt-rssi.spec"` is set in `[package.metadata.rpm]`).
- Produces: a self-contained RPM `.spec` that builds from `target/release/bt-rssi` (cargo's release output) and installs the same file set as the `.deb` to FHS-correct paths. Pre/post hooks auto-enable / disable / start / stop the systemd unit.

- [ ] **Step 1: Create the directory**

Run: `mkdir -p services/bt-rssi/rpm`

- [ ] **Step 2: Write the spec**

Create `services/bt-rssi/rpm/bt-rssi.spec` with exactly this content:

```spec
# Disable rpmlint's "no-changelog" warning; we track changes in git, not RPM.
%global _disable_source_fetch 0
%global debug_package %{nil}

Name:           bt-rssi
Version:        0.1.0
Release:        1%{?dist}
Summary:        Bluetooth RSSI D-Bus service for gnome-bluetooth-smartlock
License:        MIT
URL:            https://github.com/ba0f3/gnome-bluetooth-smartlock
Source0:        bt-rssi

BuildRequires:  systemd
Requires:       systemd
Requires:       dbus

%description
Bluetooth RSSI D-Bus service for gnome-bluetooth-smartlock. Exposes
org.gnome.BluetoothRSSI on the system bus so the GNOME Shell extension
can read RSSI values for already-paired Bluetooth devices. Requires
CAP_NET_ADMIN (granted by the bundled systemd unit).

%install
mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}%{_unitdir}
mkdir -p %{buildroot}%{_sysconfdir}/dbus-1/system.d
mkdir -p %{buildroot}%{_datadir}/dbus-1/system-services
install -m 755 %{SOURCE0}                           %{buildroot}%{_bindir}/bt-rssi
install -m 644 %{_sourcedir}/../bt-rssi.service     %{buildroot}%{_unitdir}/bt-rssi.service
install -m 644 %{_sourcedir}/../org.gnome.BluetoothRSSI.conf        %{buildroot}%{_sysconfdir}/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
install -m 644 %{_sourcedir}/../org.gnome.BluetoothRSSI.dbus-service %{buildroot}%{_datadir}/dbus-1/system-services/org.gnome.BluetoothRSSI.service

%files
%{_bindir}/bt-rssi
%{_unitdir}/bt-rssi.service
%config(noreplace) %{_sysconfdir}/dbus-1/system.d/org.gnome.BluetoothRSSI.conf
%{_datadir}/dbus-1/system-services/org.gnome.BluetoothRSSI.service

%pre
getent group bt-rssi >/dev/null || groupadd -r bt-rssi
getent passwd bt-rssi >/dev/null || useradd -r -g bt-rssi -s /usr/sbin/nologin -d / -M bt-rssi
exit 0

%post
%systemd_post bt-rssi.service
systemctl reload dbus.service 2>/dev/null || :

%preun
%systemd_preun bt-rssi.service

%postun
%systemd_postun_with_restart bt-rssi.service
systemctl reload dbus.service 2>/dev/null || :

%changelog
```

- [ ] **Step 3: Verify spec syntax with rpmspec (if available)**

Run: `command -v rpmspec >/dev/null && rpmspec -P services/bt-rssi/rpm/bt-rssi.spec >/dev/null && echo "spec-ok" || echo "rpmspec not available locally — CI verifies"`
Expected: either `spec-ok` (rpmspec installed) or `rpmspec not available locally — CI verifies`. The CI Ubuntu runner has `rpm` installed by the new apt-get install line; on macOS without rpmspec, skip and rely on CI.

- [ ] **Step 4: Verify the spec paths point at real files**

Run: `ls services/bt-rssi.service services/org.gnome.BluetoothRSSI.conf services/org.gnome.BluetoothRSSI.dbus-service`
Expected: three filenames listed, no errors.

- [ ] **Step 5: Commit**

```bash
git add services/bt-rssi/rpm/bt-rssi.spec
git commit -m "build(services): add custom RPM spec with auto-enable hooks"
```

---

## Task 4: Add Makefile targets

**Files:**
- Modify: `Makefile` (append only — do not touch existing targets)

**Interfaces:**
- Consumes: existing `SERVICE_DIR`, `SERVICE_VERSION`, `SERVICE_BIN` variables (Task 3 of the prior plan).
- Produces: three new phony targets — `service-package-deb` runs `cargo deb`, `service-package-rpm` runs `cargo rpm build`, `service-package` depends on both.

- [ ] **Step 1: Append the three targets**

Append to `Makefile` (do not modify any existing line):

```make

# ── native packages ──────────────────────────────────────────────────────────
.PHONY: service-package-deb service-package-rpm service-package

service-package-deb: service-build
	cd $(SERVICE_DIR) && cargo deb

service-package-rpm: service-build
	cd $(SERVICE_DIR) && cargo rpm build

service-package: service-package-deb service-package-rpm
```

- [ ] **Step 2: Verify the new targets are visible**

Run: `make -n service-package-deb && make -n service-package-rpm && make -n service-package`
Expected: each invocation prints the corresponding `cargo deb` / `cargo rpm build` line, exit code 0. (cargo invocations will fail on macOS due to the Linux-only libc constants — that's OK; we are only checking that the Makefile resolves the targets correctly. Use `|| true` if needed.)

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "build: add service-package-deb, service-package-rpm, service-package"
```

---

## Task 5: Update CI workflow

**Files:**
- Modify: `.github/workflows/release.yml` (insert new steps; update existing release step)

**Interfaces:**
- Consumes: the existing workflow with steps `Checkout`, `Install build dependencies`, `Build extension package`, `Build and test bt-rssi service`, `Package bt-rssi service`, `Publish GitHub Release`.
- Produces: two new steps (`Install cargo packagers`, `Build .deb and .rpm`) between `Package bt-rssi service` and `Publish GitHub Release`, plus a `Locate package artifacts` step that exposes `deb` and `rpm` outputs. The `Publish GitHub Release` step attaches both new artifacts alongside the tarball and the extension zip.

- [ ] **Step 1: Add the three new steps**

In `.github/workflows/release.yml`, find the existing `Package bt-rssi service` step followed by `Publish GitHub Release`. Insert these three steps between them (six-space indent, matching the existing `- name:` entries):

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

- [ ] **Step 2: Update the release step to attach the new artifacts**

Find the existing `gh release create ...` block in the `Publish GitHub Release` step. Replace it with:

```yaml
          gh release create "${{ github.ref_name }}" \
            bluetooth-smartlock@ba0f3.github.com.shell-extension.zip \
            bt-rssi-*.tar.gz \
            ${{ steps.pkg.outputs.deb }} \
            ${{ steps.pkg.outputs.rpm }} \
            --generate-notes
```

- [ ] **Step 3: Validate the YAML**

Run: `python3 -m venv /tmp/yaml-check && /tmp/yaml-check/bin/pip install --quiet pyyaml && /tmp/yaml-check/bin/python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml-ok')" && rm -rf /tmp/yaml-check`
Expected: `yaml-ok`, exit code 0. (On macOS, the system Python blocks `pip install` via PEP 668; a venv sidesteps that. If a global PyYAML is available, `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml-ok')"` works directly.)

- [ ] **Step 4: Read the diff**

Run: `git diff HEAD -- .github/workflows/release.yml`
Expected: shows the three inserted steps and the updated `gh release create` line, no other lines changed.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build and attach .deb and .rpm to bt-rssi release"
```

---

## Task 6: Update `services/README.md`

**Files:**
- Modify: `services/README.md` (insert one new subsection; do not modify other sections)

**Interfaces:**
- Consumes: existing `services/README.md` content (Build / Install / Uninstall sections).
- Produces: a new "Native packages (Debian / Ubuntu / Fedora / RHEL)" subsection placed between "Build" and "Install / Uninstall", showing install commands for both distro families and noting the FHS-vs-`install.sh` path divergence.

- [ ] **Step 1: Locate the insertion point**

Run: `grep -n '^## ' services/README.md`
Expected output (exact):
```
3:## What it is / why it exists
17:## D-Bus interface
46:## Deployment layout
57:## Build
75:## Install / Uninstall
```

- [ ] **Step 2: Insert the new subsection**

Find the `## Install / Uninstall` heading. Insert the following block immediately above it (between the `## Build` section's closing block and the `## Install / Uninstall` heading):

````markdown
## Native packages (Debian / Ubuntu / Fedora / RHEL)

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

- [ ] **Step 3: Verify the new structure**

Run: `grep -nE '^## ' services/README.md`
Expected: the new `## Native packages (Debian / Ubuntu / Fedora / RHEL)` heading appears between `## Build` and `## Install / Uninstall`.

- [ ] **Step 4: Commit**

```bash
git add services/README.md
git commit -m "docs(services): document native .deb and .rpm install paths"
```

---

## Task 7: Update root `README.md`

**Files:**
- Modify: `README.md` (edit one sentence in the "Install from source" section; update the `## Releases` listing)

**Interfaces:**
- Consumes: existing root `README.md` content — specifically the proximity-locking install blurb (added by Task 5 of the prior plan) and the `## Releases` section.
- Produces: a small rewrite of the proximity-locking install blurb that mentions `.deb` and `.rpm` first, with the tarball as the fallback. A `## Releases` section that lists four artifacts instead of two.

- [ ] **Step 1: Read the current install blurb and Releases section**

Run: `sed -n '50,80p' README.md`
Expected: shows the proximity-locking install blurb and the `## Releases` section.

- [ ] **Step 2: Update the proximity-locking install blurb**

Find this exact text in `README.md`:

```markdown
Proximity locking also needs the `bt-rssi` service installed on the host.
Download the matching `bt-rssi-<version>.tar.gz` from the
[Releases](#releases) section below and run `sudo ./install.sh` from
inside the extracted tarball.
```

Replace it with:

```markdown
Proximity locking also needs the `bt-rssi` service installed on the host.
Download the matching `.deb` (Debian / Ubuntu) or `.rpm` (Fedora / RHEL)
from the [Releases](#releases) section below and install with
`sudo apt install ./bt-rssi_*.deb` (or `sudo dnf install ./bt-rssi-*.rpm`).
The tarball + `install.sh` path is the fallback for other distros.
```

- [ ] **Step 3: Update the `## Releases` section**

Find this exact text in `README.md`:

```markdown
Each GitHub release publishes two artifacts:

- `bluetooth-smartlock@ba0f3.github.com.shell-extension.zip` — the
  GNOME Shell extension, installable with `gnome-extensions install`.
- `bt-rssi-<version>.tar.gz` — the RSSI D-Bus service, installable
  with `sudo ./install.sh` (see [`services/README.md`](services/README.md)).
```

Replace it with:

```markdown
Each GitHub release publishes four artifacts:

- `bluetooth-smartlock@ba0f3.github.com.shell-extension.zip` — the
  GNOME Shell extension, installable with `gnome-extensions install`.
- `bt-rssi-<version>.tar.gz` — the RSSI D-Bus service, installable
  with `sudo ./install.sh` (see [`services/README.md`](services/README.md)).
- `bt-rssi-<version>_amd64.deb` — Debian / Ubuntu package, installable
  with `sudo apt install ./<file>.deb`.
- `bt-rssi-<version>-1.<arch>.rpm` — Fedora / RHEL package,
  installable with `sudo dnf install ./<file>.rpm`.
```

- [ ] **Step 4: Verify the heading structure is unchanged**

Run: `grep -nE '^##? ' README.md`
Expected: same heading list as before this task (titles preserved; only the prose body changed).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: surface native .deb and .rpm in README install blurb and releases"
```

---

## Task 8: End-to-end verification

**Files:**
- Modify: none (verification only)

**Interfaces:**
- Consumes: every artifact produced by Tasks 1–7.
- Produces: a verified clean state where: `python3 -c "import tomllib; ..."` parses the new Cargo.toml; the spec / debian scripts / Makefile / CI YAML are syntactically valid; `git status` is clean; the git log shows 7 new commits at the tip.

- [ ] **Step 1: Re-validate Cargo.toml**

Run: `python3 -c "import tomllib; tomllib.loads(open('services/bt-rssi/Cargo.toml').read()); print('toml-ok')"`
Expected: `toml-ok`.

- [ ] **Step 2: Re-validate the debian scripts**

Run: `bash -n services/bt-rssi/debian/postinst && bash -n services/bt-rssi/debian/prerm && echo "debian-scripts-ok"`
Expected: `debian-scripts-ok`.

- [ ] **Step 3: Re-validate the CI workflow YAML**

Run: `python3 -m venv /tmp/yaml-check && /tmp/yaml-check/bin/pip install --quiet pyyaml && /tmp/yaml-check/bin/python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml-ok')" && rm -rf /tmp/yaml-check`
Expected: `yaml-ok`.

- [ ] **Step 4: Verify Makefile targets exist**

Run: `make -n service-package-deb | head -n1 && make -n service-package-rpm | head -n1 && make -n service-package | head -n1`
Expected: three lines, each starting with `cd services/bt-rssi && cargo ...`.

- [ ] **Step 5: Verify all referenced source paths exist**

Run:
```bash
for f in \
  services/bt-rssi.service \
  services/org.gnome.BluetoothRSSI.conf \
  services/org.gnome.BluetoothRSSI.dbus-service \
  services/bt-rssi/debian/postinst \
  services/bt-rssi/debian/prerm \
  services/bt-rssi/rpm/bt-rssi.spec \
  services/bt-rssi/Cargo.toml; do
  test -f "$f" && echo "ok   $f" || echo "MISS $f"
done
```
Expected: seven `ok` lines, no `MISS`.

- [ ] **Step 6: Confirm `make service-package` cannot run on macOS but would on Linux**

Run on macOS (expected to fail with the same Linux-only libc error as `make service-build`):

```bash
make service-package 2>&1 | tail -n 5 || true
```

Expected: ends with the `SOCK_CLOEXEC` / `HCI_CHANNEL_CONTROL` compile error or a `cargo deb` / `cargo rpm build` invocation that fails for the same reason. This is expected on macOS; CI (Ubuntu runner) is the canonical verifier.

- [ ] **Step 7: Inspect the final git log and status**

Run:
```bash
git log --oneline 0bcb5f3..HEAD
git status --short
```
Expected: `git log` shows 7 new commits at the tip, each scoped to one task (Cargo.toml metadata; debian scripts; RPM spec; Makefile targets; CI workflow; services README; root README). `git status` shows only the untracked `.DS_Store` and `.omo/` (not from this work).

- [ ] **Step 8: No commit (verification only)**

This task produces no commit. If any verification step fails, fix the
underlying issue and commit a fix before declaring the work done.
