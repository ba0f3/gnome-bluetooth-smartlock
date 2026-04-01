import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import bluetooth from "./bluetooth/dbus.js";
import { extLog, extErr, extDebug } from './log.js';
// eslint-disable-next-line no-unused-vars
const SmartLock = class SmartLock {
    constructor(settings) {
        this._settings = settings
        this._disconnectTimeoutId = null;
        this._reconnectIntervalId = null;
        this._proximityTimeoutId = null;
        this._proximitySignalId = null;
    }

    lock_screen() {
        if (!Main.screenShield.locked) {
            Main.overview.hide();
            Main.screenShield.lock(true);
        }
    }

    unlock_screen() {
        extLog('Device reconnected, unlocking screen');
        Main.screenShield.deactivate(false);
    }

    async enable() {
        extLog('Enabling extension');

        bluetooth.subscribe((device) => this._checkDevice(device));
        bluetooth.checkRssiService();
        bluetooth.subscribeRssi(({ address, rssi }) => this._onRssiUpdate(address, rssi));
        this._proximitySignalId = this._settings.connectProximityLockSignal(
            (enabled) => this._onProximityLockChanged(enabled)
        );

        extLog('Subscribing to D-Bus signals');

        try {
            let devices = await bluetooth.getDevices();
            if (this._disabled)
                return;
            for (const device of devices) {
                this._checkDevice(device);
            }
        } catch (e) {
            if (!this._disabled)
                extErr('Initial Bluetooth enumeration failed', e);
            return;
        }

    }

    async onDeviceChanged() {
        this._clearDisconnectTimeout();
        this._clearProximityTimeout();
        this._settings.setLastSeen(0);
        await this.checkNow();
    }

    async checkNow() {
        try {
            let devices = await bluetooth.getDevices();
            if (this._disabled)
                return;
            for (const device of devices) {
                this._checkDevice(device);
            }
        } catch (e) {
            if (!this._disabled)
                extErr('Bluetooth refresh failed', e);
        }
    }

    _checkDevice(device) {

        if (device.address !== this._settings.getDevice()) {
            extLog(`BT -> Device ${device.name} [${device.address}] is not the target device ${this._settings.getDevice()}, ignoring.`);
            return;
        }

        if (device.connected) {
            extLog(`BT -> Device ${device.name} [${device.address}] is connected, resetting last seen time.`);
            this._settings.setLastSeen(new Date().getTime());
            this._clearDisconnectTimeout();
            this._clearReconnectInterval();
            bluetooth.cancelPage();
            this._clearProximityTimeout();
            if (this._settings.getAutoUnlock() && Main.screenShield.locked)
                this.unlock_screen();
            if (this._settings.getProximityLock())
                bluetooth.startRssiMonitoring(device.address, this._settings.getPollingInterval());
            return;
        }

        let lastSeen = this._settings.getLastSeen();

        // Actively page the device to detect its return (optional).
        if (this._settings.getReconnectPolling() && !this._reconnectIntervalId) {
            const reconnectInterval = this._settings.getPollingInterval();
            extLog(`BT -> Device ${device.address} is not connected, starting reconnect every ${reconnectInterval}s.`);
            bluetooth.reconnect(device.address);
            this._reconnectIntervalId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                reconnectInterval,
                () => {
                    bluetooth.reconnect(device.address);
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }

        // Only start the lock timer if the device was previously seen
        // (prevents locking on extension startup when phone is already away).
        if (lastSeen === 0) {
            extLog(`BT -> Device ${device.name} [${device.address}] was not seen recently, skipping lock timer.`);
            return;
        }

        let duration = this._settings.getAwayDuration() || 5;
        this._settings.setLastSeen(0);
        extLog(`BT -> Device ${device.address} not connected, locking in ${duration}s.`);

        this._disconnectTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            duration,
            () => {
                this._disconnectTimeoutId = null;

                if (this._settings.getLastSeen() > 0) {
                    extLog(`Device ${device.address} is now connected, cancelling lock timeout.`);
                    this._clearReconnectInterval();
                } else {
                    extLog(`User stepped away for ${duration} seconds, locking the screen`);
                    this.lock_screen();
                    // Keep reconnecting so we detect the phone returning.
                }

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _onProximityLockChanged(enabled) {
        let targetDevice = this._settings.getDevice();
        if (!targetDevice) return;

        if (enabled) {
            extLog(`Proximity lock enabled, starting RSSI monitoring for ${targetDevice}`);
            bluetooth.startRssiMonitoring(targetDevice, this._settings.getPollingInterval());
        } else {
            extLog(`Proximity lock disabled, stopping RSSI monitoring for ${targetDevice}`);
            bluetooth.stopRssiMonitoring(targetDevice);
            this._clearProximityTimeout();
            this._settings.setLastSeen(Date.now());
        }
    }

    _onRssiUpdate(address, rssi) {
        if (address !== this._settings.getDevice()) return;
        if (!this._settings.getProximityLock()) return;

        let threshold = this._settings.getRssiThreshold();
        extDebug(`RSSI update: ${address} rssi=${rssi} threshold=${threshold}`);

        if (rssi < threshold) {
            extDebug(`RSSI ${rssi} below threshold ${threshold}, starting lock timer`);
            this._startProximityTimeout();
        } else {
            this._clearProximityTimeout();
            this._settings.setLastSeen(new Date().getTime());
            if (this._settings.getAutoUnlock() && Main.screenShield.locked)
                this.unlock_screen();
        }
    }

    _startProximityTimeout() {
        if (this._proximityTimeoutId) return;

        let duration = this._settings.getAwayDuration() || 5;
        this._settings.setLastSeen(0);
        this._proximityTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            duration,
            () => {
                this._proximityTimeoutId = null;
                if (this._settings.getLastSeen() > 0) {
                    extLog('Device reconnected, cancelling lock timeout.');
                } else {
                    extLog(`RSSI below threshold for ${duration} seconds, locking the screen`);
                    this.lock_screen();
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _clearReconnectInterval() {
        if (this._reconnectIntervalId) {
            GLib.source_remove(this._reconnectIntervalId);
            this._reconnectIntervalId = null;
        }
    }

    _clearDisconnectTimeout() {
        if (this._disconnectTimeoutId) {
            GLib.source_remove(this._disconnectTimeoutId);
            this._disconnectTimeoutId = null;
        }
    }

    _clearProximityTimeout() {
        if (this._proximityTimeoutId) {
            GLib.source_remove(this._proximityTimeoutId);
            this._proximityTimeoutId = null;
        }
    }

    disable() {
        this._disabled = true;
        this._clearDisconnectTimeout();
        this._clearReconnectInterval();
        this._clearProximityTimeout();

        if (this._proximitySignalId) {
            this._settings.disconnectSignal(this._proximitySignalId);
            this._proximitySignalId = null;
        }

        extLog('Disabling extension');

        let targetDevice = this._settings.getDevice();
        if (targetDevice)
            bluetooth.stopRssiMonitoring(targetDevice);

        this._settings.setLastSeen(0);

        bluetooth.disconnect();
    }

};


export default SmartLock
