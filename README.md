# Bluetooth Smart Lock ![Smart Lock black icon](https://raw.githubusercontent.com/ba0f3/gnome-bluetooth-smartlock/main/icons/smartlock-black.svg)  ![Smart Lock white icon](https://raw.githubusercontent.com/ba0f3/gnome-bluetooth-smartlock/main/icons/smartlock-white.svg)

Dynamic lock for GNOME. Use your smart phone/watch/band to lock your desktop automatically when you step away.

When your device is out of bluetooth range or get disconnected, it will lock your desktop automatically.

** This extension use **smart lock** icon by Andi from [Noun Project](https://thenounproject.com/browse/icons/term/smart-lock)

## Usage

Click on *Smart Lock* icon to activate its menu, and select one of your paired devices as your smart lock

![Smart lock menu](https://raw.githubusercontent.com/ba0f3/gnome-bluetooth-smartlock/main/screenshots/screenshot1.png)


** This extension will try to connects to your device frequently (for some reason (idk yet), `bluez` wont reconnect to smart phone after disconnected)

### Settings

![Settings](https://raw.githubusercontent.com/ba0f3/gnome-bluetooth-smartlock/main/screenshots/screenshot2.png)

The extension comes with default settings, but you can tweak them as your need.

![Advanced settings](https://raw.githubusercontent.com/ba0f3/gnome-bluetooth-smartlock/main/screenshots/screenshot3.png)

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

## Installation

### Requirements

 * bluez (on debian based distro: `sudo apt install bluez`)

### Installation from extensions.gnome.org

https://extensions.gnome.org/extension/5359/bluetooth-smart-lock/

### Install from source

Requires:

* git
* make
* (for proximity locking) the Rust toolchain — see
  [`services/README.md`](services/README.md)

```sh
git clone https://github.com/ba0f3/gnome-bluetooth-smartlock.git
cd gnome-bluetooth-smartlock
make install
```

Proximity locking also needs the `bt-rssi` service installed on the host.
Download the matching `.deb` (Debian / Ubuntu) or `.rpm` (Fedora / RHEL)
from the [Releases](#releases) section below and install with
`sudo apt install ./bt-rssi_*.deb` (or `sudo dnf install ./bt-rssi-*.rpm`).
The tarball + `install.sh` path is the fallback for other distros.

## Releases

Each GitHub release publishes four artifacts:

- `bluetooth-smartlock@ba0f3.github.com.shell-extension.zip` — the
  GNOME Shell extension, installable with `gnome-extensions install`.
- `bt-rssi-<version>.tar.gz` — the RSSI D-Bus service, installable
  with `sudo ./install.sh` (see [`services/README.md`](services/README.md)).
- `bt-rssi-<version>_amd64.deb` — Debian / Ubuntu package, installable
  with `sudo apt install ./<file>.deb`.
- `bt-rssi-<version>-1.<arch>.rpm` — Fedora / RHEL package,
  installable with `sudo dnf install ./<file>.rpm`.

Find both at <https://github.com/ba0f3/gnome-bluetooth-smartlock/releases>.