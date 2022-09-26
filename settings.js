const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


const SCAN_INTERVAL_KEY = 'interval';
const ACTIVE_KEY = 'active';
const AWAY_DURATION = 'duration-in-seconds';
const HIDE_INDICATOR_KEY = 'indicator';
const DEVICE_MAC_KEY = 'mac';

// eslint-disable-next-line no-unused-vars
var Settings = class Settings {
    constructor() {
        this._settings = ExtensionUtils.getSettings(Me.metadata['settings-schema']);
    }

    getScanInterval() {
        return this._settings.get_int(SCAN_INTERVAL_KEY);
    }

    setScanInterval(interval) {
        this._settings.set_int(SCAN_INTERVAL_KEY, interval);
    }

    getAwayDuration() {
        return this._settings.get_int(AWAY_DURATION);
    }

    setAwayDuration(duration) {
        this._settings.set_int(AWAY_DURATION, duration);
    }

    getActive() {
        return this._settings.get_boolean(ACTIVE_KEY);
    }

    setActive(mode) {
        this._settings.set_boolean(ACTIVE_KEY, mode);
    }

    getHideIndicator() {
        return this._settings.get_boolean(HIDE_INDICATOR_KEY);
    }

    setHideIndicator(value) {
        this._settings.set_boolean(HIDE_INDICATOR_KEY, value);
    }

    getDevice() {
        return this._settings.get_string(DEVICE_MAC_KEY);
    }

    setDevice(device) {
        if (device !== this.getDevice())
            this._settings.set_string(DEVICE_MAC_KEY, device);
    }
};
