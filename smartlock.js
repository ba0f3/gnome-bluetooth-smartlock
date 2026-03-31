import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import bluetooth from "./bluetooth/dbus.js";
// eslint-disable-next-line no-unused-vars
const SmartLock = class SmartLock {
    constructor(settings) {
        this._settings = settings
        this._lockTimeoutId = null;
        this._proximitySignalId = null;
    }

lock_screen() {
        if (!Main.screenShield.locked) {
            Main.overview.hide();
            Main.screenShield.lock(true);
        }
    }

    unlock_screen() {
        console.log('Device reconnected, unlocking screen');
        Main.screenShield.deactivate(false);
    }

    async enable() {
        console.log('Enabling extension');

        bluetooth.subscribe((device) => this._checkDevice(device));
        bluetooth.checkRssiService();
        bluetooth.subscribeRssi(({ address, rssi }) => this._onRssiUpdate(address, rssi));
        this._proximitySignalId = this._settings.connectProximityLockSignal(
            (enabled) => this._onProximityLockChanged(enabled)
        );

        console.log('Subscribing to D-Bus signals');

        let devices = await bluetooth.getDevices();
        for (const device of devices) {
            this._checkDevice(device);
        }

        let targetDevice = this._settings.getDevice();
        if (targetDevice && this._settings.getProximityLock()) {
            bluetooth.startRssiMonitoring(targetDevice, this._settings.getRssiInterval());
        }
    }

    async onDeviceChanged() {
        this._clearLockTimeout();
        this._settings.setLastSeen(0);
        await this.checkNow();
    }

    async checkNow() {
        let devices = await bluetooth.getDevices();
        for (const device of devices) {
            this._checkDevice(device);
        }
    }

    _checkDevice(device) {

        if (device.address !== this._settings.getDevice()) {
            console.log(`BT -> Device ${device.name} [${device.address}] is not the target device ${this._settings.getDevice()}, ignoring.`);
            return;
        }

        if (device.connected) {
            console.log(`BT -> Device ${device.name} [${device.address}] is connected, resetting last seen time.`);
            this._settings.setLastSeen(new Date().getTime());
            this._clearLockTimeout();
            if (this._settings.getAutoUnlock() && Main.screenShield.locked)
                this.unlock_screen();
            if (this._settings.getProximityLock())
                bluetooth.startRssiMonitoring(device.address, this._settings.getRssiInterval());
            return;
        }

        let lastSeen = this._settings.getLastSeen();
        if (lastSeen === 0) {
            console.log(`BT -> Device ${device.name} [${device.address}] was not seen recently....`);
            return;
        }

        let duration = this._settings.getAwayDuration() || 5;

        this._settings.setLastSeen(0);
        console.log(`BT -> Device ${device.address} is not connected, starting timer for ${duration} seconds.`);
        this._lockTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            duration,   // delay in seconds before locking
            () => {
                this._lockTimeoutId = null;

                // check if the device is still not connected
                if (this._settings.getLastSeen() > 0) {
                    console.log(`Device ${device.address} is now connected, cancelling lock timeout.`);
                } else {
                    console.log(`User stepped away for ${duration} seconds, locking the screen`);
                    this.lock_screen();
                }

                // Clear the timeout to prevent it from running again
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onProximityLockChanged(enabled) {
        let targetDevice = this._settings.getDevice();
        if (!targetDevice) return;

        if (enabled) {
            console.log(`Proximity lock enabled, starting RSSI monitoring for ${targetDevice}`);
            bluetooth.startRssiMonitoring(targetDevice, this._settings.getRssiInterval());
        } else {
            console.log(`Proximity lock disabled, stopping RSSI monitoring for ${targetDevice}`);
            bluetooth.stopRssiMonitoring(targetDevice);
        }
    }

    _onRssiUpdate(address, rssi) {
        if (address !== this._settings.getDevice()) return;
        if (!this._settings.getProximityLock()) return;

        let threshold = this._settings.getRssiThreshold();
        console.log(`RSSI update: ${address} rssi=${rssi} threshold=${threshold}`);

        if (rssi < threshold) {
            console.log(`RSSI ${rssi} below threshold ${threshold}, starting lock timer`);
            this._startLockTimeout();
        } else {
            this._clearLockTimeout();
            this._settings.setLastSeen(new Date().getTime());
            if (this._settings.getAutoUnlock() && Main.screenShield.locked)
                this.unlock_screen();
        }
    }

    _startLockTimeout() {
        if (this._lockTimeoutId) return;

        let duration = this._settings.getAwayDuration() || 3;
        this._settings.setLastSeen(0);
        this._lockTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            duration,
            () => {
                this._lockTimeoutId = null;
                if (this._settings.getLastSeen() > 0) {
                    console.log('Device reconnected, cancelling lock timeout.');
                } else {
                    console.log(`RSSI below threshold for ${duration} seconds, locking the screen`);
                    this.lock_screen();
                }
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

        if (this._proximitySignalId) {
            this._settings.disconnectSignal(this._proximitySignalId);
            this._proximitySignalId = null;
        }

        console.log('Disabling extension');

        let targetDevice = this._settings.getDevice();
        if (targetDevice)
            bluetooth.stopRssiMonitoring(targetDevice);

        this._settings.setLastSeen(0);

        bluetooth.disconnect();
    }

};


export default SmartLock
