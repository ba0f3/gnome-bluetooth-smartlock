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
