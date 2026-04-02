import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { extLog, extDebug } from '../log.js';
const DBus = Gio.DBus;

import { RSSI_DBUS_NAME, RSSI_DBUS_PATH, isRssiServiceAvailable } from './rssi-service.js';

let signalSubscribePropertiesChangedId = null;
let signalSubscribeInterfacesRemovedId = null;
let signalSubscribeRssiUpdateId = null;
let rssiServiceAvailable = false;

let allDevices = {};

function addressFromPath(path) {
    return path.split('/').pop().replace(/^dev_/, '').replace(/_/g, ':');
}

/**
 * Extract the HCI adapter index from a BlueZ device path.
 * E.g. '/org/bluez/hci1/dev_AA_BB_CC_DD_EE_FF' → 1
 */
function hciIndexFromPath(path) {
    let match = path.match(/\/hci(\d+)\//);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Look up the HCI adapter index for a device by MAC address.
 * Synchronous one-shot query — safe for use from the prefs process.
 */
function lookupHciIndex(address) {
    try {
        let [objects] = DBus.system.call_sync(
            'org.bluez', '/',
            'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects',
            null, null, Gio.DBusCallFlags.NONE, -1, null
        ).deep_unpack();
        for (let [path, interfaces] of Object.entries(objects)) {
            let dev = interfaces['org.bluez.Device1'];
            if (dev?.Address?.deep_unpack?.() === address)
                return hciIndexFromPath(path);
        }
    } catch (e) {
        extDebug(`lookupHciIndex: ${e.message}`);
    }
    return 0;
}
/**
 * Get a list of Bluetooth devices managed by BlueZ.
 * @returns 
 */
function getDevices() {
    return new Promise((resolve, reject) => {
        DBus.system.call(
            'org.bluez',
            '/',
            'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_conn, res) => {
                try {
                    let [objects] = DBus.system.call_finish(res).deep_unpack();
                    let devices = [];
                    for (let [objPath, interfaces] of Object.entries(objects)) {
                        let dev = interfaces['org.bluez.Device1'];
                        if (!dev) continue;

                        let name = dev.Name?.deep_unpack?.() || 'Unnamed';
                        let address = dev.Address?.deep_unpack?.() || 'No address';
                        let connected = dev.Connected?.deep_unpack?.() ?? false;
                        let paired = dev.Paired?.deep_unpack?.() ?? false;
                        let uuids = dev.UUIDs?.deep_unpack?.() ?? [];

                        let device = {
                            address,
                            name,
                            connected,
                            visible: true,
                            paired,
                            path: objPath,
                            uuids,
                        };

                        devices.push(device);

                        allDevices[address] = device;
                    }

                    // update for missing devices
                    for (let address of Object.keys(allDevices)) {
                        if (!devices.some(d => d.address === address)) {
                            devices.push({
                                address: address,
                                name: allDevices[address].name,
                                connected: false,
                                visible: false
                            });

                            // Remove from allDevices if not found
                            delete allDevices[address];
                        }
                    }

                    resolve(devices);
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

/**
 * Subscribe to device changes via D-Bus signals.
 * TODO: this does not handle devices that are removed from the system well
 * @param {*} cb 
 * @returns 
 */
function subscribe(cb) {
    disconnect();
    signalSubscribePropertiesChangedId = DBus.system.signal_subscribe(
        'org.bluez',                         // sender
        'org.freedesktop.DBus.Properties',  // interface
        'PropertiesChanged',                // signal
        null,                               // object path (null = all)
        null,                               // arg0
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, path, _iface, _signal, params) => {
            let [ifaceName, changedProps] = params.deep_unpack();
            if (ifaceName !== 'org.bluez.Device1') return;

            let address = addressFromPath(path);
            let isConnected = changedProps['Connected']?.deep_unpack?.();

            extLog(`DBus PropertiesChanged: ${address} changed=[${Object.keys(changedProps)}] connected=${isConnected}`);

            let device = {
                name: allDevices[address]?.name || 'Unnamed',
                address: address,
                connected: isConnected ?? allDevices[address]?.connected ?? false,
                visible: true,
                path: path,
            };

            allDevices[address] = device;

            cb(device);
        }
    );

    signalSubscribeInterfacesRemovedId = DBus.system.signal_subscribe(
        'org.bluez',
        'org.freedesktop.DBus.ObjectManager',
        'InterfacesRemoved',
        null,
        null,
        Gio.DBusSignalFlags.NONE,
        (_conn, _sender, _objectPath, _iface, _signal, params) => {
            let [removedPath, interfaces] = params.deep_unpack();

            let address = addressFromPath(removedPath);
            extLog(`DBus InterfacesRemoved: ${address} interfaces=[${interfaces}]`);

            if (interfaces.includes('org.bluez.Device1')) {
                delete allDevices[address];

                cb({
                    address: address,
                    connected: false,
                    visible: false
                });
            }
        }
    );
}

function checkRssiService() {
    rssiServiceAvailable = isRssiServiceAvailable();
    if (!rssiServiceAvailable)
        extLog(`${RSSI_DBUS_NAME} service not found — RSSI monitoring disabled`);
    return rssiServiceAvailable;
}

function startRssiMonitoring(address, intervalSeconds) {
    if (!rssiServiceAvailable) return;
    let hciIndex = allDevices[address]?.path
        ? hciIndexFromPath(allDevices[address].path) : 0;
    DBus.system.call(
        RSSI_DBUS_NAME,
        RSSI_DBUS_PATH,
        'org.gnome.BluetoothRSSI',
        'StartMonitoring',
        new GLib.Variant('(suq)', [address, intervalSeconds, hciIndex]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
            try {
                conn.call_finish(res);
                extLog(`RSSI monitoring started for ${address}`);
            } catch (e) {
                extLog(`Failed to start RSSI monitoring: ${e.message}`);
            }
        }
    );
}

function stopRssiMonitoring(address) {
    if (!rssiServiceAvailable) return;
    DBus.system.call(
        RSSI_DBUS_NAME,
        RSSI_DBUS_PATH,
        'org.gnome.BluetoothRSSI',
        'StopMonitoring',
        new GLib.Variant('(s)', [address]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
            try {
                conn.call_finish(res);
                extLog(`RSSI monitoring stopped for ${address}`);
            } catch (e) {
                extLog(`Failed to stop RSSI monitoring: ${e.message}`);
            }
        }
    );
}

function subscribeRssi(cb) {
    if (signalSubscribeRssiUpdateId) {
        DBus.system.signal_unsubscribe(signalSubscribeRssiUpdateId);
    }
    signalSubscribeRssiUpdateId = DBus.system.signal_subscribe(
        RSSI_DBUS_NAME,
        'org.gnome.BluetoothRSSI',
        'RssiUpdate',
        RSSI_DBUS_PATH,
        null,
        Gio.DBusSignalFlags.NONE,
        (conn, sender, path, iface, signal, params) => {
            let [address, rssi] = params.deep_unpack();
            extDebug(`RSSI update: ${address} rssi=${rssi}`);

            if (allDevices[address]) {
                allDevices[address].rssi = rssi;
            }

            cb({ address, rssi });
        }
    );
}

let pageAbortTimeoutId = null;

/**
 * Short-burst reconnect attempt via org.bluez.Device1.ConnectProfile().
 * Uses a profile UUID that BlueZ has no local handler for — this triggers
 * an ACL page (presence detection) without the noisy HFP/A2DP connection
 * attempts. Falls back to Connect() if no suitable UUID is known.
 *
 * Aborts after PAGE_TIMEOUT_MS if the phone doesn't respond.
 */
const PAGE_TIMEOUT_MS = 2500;

// BlueZ standard profile UUIDs that produce noisy reconnect logs.
const NOISY_PROFILES = new Set([
    '0000110a-0000-1000-8000-00805f9b34fb', // A2DP Source
    '0000110b-0000-1000-8000-00805f9b34fb', // A2DP Sink
    '0000110d-0000-1000-8000-00805f9b34fb', // Advanced Audio
    '00001112-0000-1000-8000-00805f9b34fb', // Headset AG
    '0000111f-0000-1000-8000-00805f9b34fb', // Handsfree AG
    '0000111e-0000-1000-8000-00805f9b34fb', // Handsfree
    '00001108-0000-1000-8000-00805f9b34fb', // Headset
]);

/**
 * Pick a UUID for ConnectProfile that triggers an ACL page
 * but avoids noisy profile handlers (HFP, A2DP).
 */
function _pickQuietUuid(address) {
    let dev = allDevices[address];
    if (!dev?.uuids) return null;
    for (let uuid of dev.uuids) {
        if (uuid && !NOISY_PROFILES.has(uuid))
            return uuid;
    }
    return null;
}

function reconnect(address) {
    let devPath = allDevices[address]?.path;
    if (!devPath) {
        extDebug(`reconnect: no known path for ${address}, skipping`);
        return;
    }

    _clearPageAbortTimeout();

    let quietUuid = _pickQuietUuid(address);
    let method, args;
    if (quietUuid) {
        method = 'ConnectProfile';
        args = new GLib.Variant('(s)', [quietUuid]);
        extDebug(`Attempting reconnect: ${address} via ${quietUuid} (${PAGE_TIMEOUT_MS}ms burst)`);
    } else {
        method = 'Connect';
        args = null;
        extDebug(`Attempting reconnect: ${address} via Connect (${PAGE_TIMEOUT_MS}ms burst)`);
    }

    DBus.system.call(
        'org.bluez',
        devPath,
        'org.bluez.Device1',
        method,
        args,
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
            try {
                conn.call_finish(res);
                _clearPageAbortTimeout();
                extLog(`Reconnect succeeded: ${address}`);
            } catch (e) {
                extDebug(`Reconnect failed: ${address}: ${e.message}`);
            }
        }
    );

    pageAbortTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        PAGE_TIMEOUT_MS,
        () => {
            pageAbortTimeoutId = null;
            extLog(`Page timeout after ${PAGE_TIMEOUT_MS}ms, aborting: ${address}`);
            DBus.system.call(
                'org.bluez',
                devPath,
                'org.bluez.Device1',
                'Disconnect',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (conn, res) => {
                    try {
                        conn.call_finish(res);
                        extDebug(`Page abort disconnect done: ${address}`);
                    } catch (e) {
                        extDebug(`Page abort disconnect: ${address}: ${e.message}`);
                    }
                }
            );
            return GLib.SOURCE_REMOVE;
        }
    );
}

function _clearPageAbortTimeout() {
    if (pageAbortTimeoutId) {
        GLib.source_remove(pageAbortTimeoutId);
        pageAbortTimeoutId = null;
    }
}

/**
 * Cancel any in-flight page abort timer. Call this when the device
 * connects successfully, or during teardown.
 */
function cancelPage() {
    _clearPageAbortTimeout();
}

/**
 * Disconnect from all D-Bus signals and clear any active polling.
 */
function disconnect() {
    _clearPageAbortTimeout();
    if (signalSubscribeRssiUpdateId) {
        DBus.system.signal_unsubscribe(signalSubscribeRssiUpdateId);
        signalSubscribeRssiUpdateId = null;
    }
    if (signalSubscribePropertiesChangedId) {
        DBus.system.signal_unsubscribe(signalSubscribePropertiesChangedId);
        signalSubscribePropertiesChangedId = null;
    }

    if (signalSubscribeInterfacesRemovedId) {
        DBus.system.signal_unsubscribe(signalSubscribeInterfacesRemovedId);
        signalSubscribeInterfacesRemovedId = null;
    }

    allDevices = {};
}

export default {
    getDevices,
    subscribe,
    checkRssiService,
    subscribeRssi,
    startRssiMonitoring,
    stopRssiMonitoring,
    reconnect,
    cancelPage,
    lookupHciIndex,
    disconnect
};
