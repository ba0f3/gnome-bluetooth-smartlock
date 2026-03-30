import Gio from 'gi://Gio';

export const RSSI_DBUS_NAME = 'org.gnome.BluetoothRSSI';
export const RSSI_DBUS_PATH = '/org/gnome/BluetoothRSSI';

/**
 * Check if the bt-rssi D-Bus service is installed (activatable on the system bus).
 * Uses a synchronous call — the query goes to the local bus daemon and returns
 * in microseconds, so blocking is negligible.
 * @returns {boolean}
 */
export function isRssiServiceAvailable() {
    try {
        const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
        const result = bus.call_sync(
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            'ListActivatableNames',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null
        );
        const [names] = result.deep_unpack();
        return names.includes(RSSI_DBUS_NAME);
    } catch (e) {
        return false;
    }
}
