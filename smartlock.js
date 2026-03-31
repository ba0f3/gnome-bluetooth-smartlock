import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import bluetooth from "./bluetooth/dbus.js";


// eslint-disable-next-line no-unused-vars
const SmartLock = class SmartLock {
    constructor(settings) {
        this._settings = settings
        this._lockTimeoutId = null;
    }

    _log(message) {
        log(`[bluetooth-smartlock] ${message}`);
    }

    lock_screen() {
        if (!Main.screenShield.locked) {
            Main.overview.hide();
            Main.screenShield.lock(true);
        }
    }

    unlock_screen() {
        this._log('Device reconnected, unlocking screen');
        Main.screenShield.deactivate(false);
    }

    async enable() {
        this._log('Enabling extension');

        bluetooth.subscribe((device) => this._checkDevice(device));

        this._log('Subscribing to D-Bus signals');

        let devices = await bluetooth.getDevices();
        for (const device of devices) {
            this._checkDevice(device);
        }
    }

    async checkNow() {
        let devices = await bluetooth.getDevices();
        for (const device of devices) {
            this._checkDevice(device);
        }
    }

    _checkDevice(device) {

        if (device.address !== this._settings.getDevice()) {
            this._log(`BT -> Device ${device.name} [${device.address}] is not the target device ${this._settings.getDevice()}, ignoring.`);
            return;
        }

        if (device.connected) {
            this._log(`BT -> Device ${device.name} [${device.address}] is connected, resetting last seen time.`);
            this._settings.setLastSeen(new Date().getTime());
            this._clearLockTimeout();
            if (this._settings.getAutoUnlock() && Main.screenShield.locked)
                this.unlock_screen();
            return;
        }

        let lastSeen = this._settings.getLastSeen();
        if (lastSeen === 0) {
            this._log(`BT -> Device ${device.name} [${device.address}] was not seen recently....`);
            return;
        }

        let duration = this._settings.getAwayDuration() || 5;

        this._settings.setLastSeen(0);
        this._log(`BT -> Device ${device.address} is not connected, starting timer for ${duration} seconds.`);
        this._lockTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            duration,   // delay in seconds before locking
            () => {
                this._lockTimeoutId = null;

                // check if the device is still not connected
                if (this._settings.getLastSeen() > 0) {
                    this._log(`Device ${device.address} is now connected, cancelling lock timeout.`);
                } else {
                    this._log(`User stepped away for ${duration} seconds, locking the screen`);
                    this.lock_screen();
                }

                // Clear the timeout to prevent it from running again
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _clearLockTimeout() {
        if (this._lockTimeoutId) {
            GLib.source_remove(this._lockTimeoutId);
            this._lockTimeoutId = null;
        }


    }

    disable() {
        this._clearLockTimeout()

        this._log('Disabling extension');

        this._settings.setLastSeen(0);

        bluetooth.disconnect();
    }

};


export default SmartLock
