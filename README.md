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
## Installation

### Requirements

 * bluez (on debian based distro: `sudo apt install bluez`)

### Installation from extensions.gnome.org

https://extensions.gnome.org/extension/5359/bluetooth-smart-lock/

### Install from source

Requires:
* git
* make

```sh
git clone https://github.com/ba0f3/gnome-bluetooth-smartlock.git
cd gnome-bluetooth-smartlock
make install
```