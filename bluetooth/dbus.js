import GLib from 'gi://GLib';
const DBus = imports.gi.Gio.DBus;
const Gio = imports.gi.Gio;

import { RSSI_DBUS_NAME, RSSI_DBUS_PATH, isRssiServiceAvailable } from './rssi-service.js';
import { logInfo } from '../log.js';

let signalSubscribePropertiesChangedId = null;
let signalSubscribeInterfacesRemovedId = null;
let signalSubscribeRssiUpdateId = null;
let rssiServiceAvailable = false;
let allDevices = {};
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
            (conn, res) => {
                let [objects] = Gio.DBus.system.call_finish(res).deep_unpack();
                let devices = [];
                for (let [path, interfaces] of Object.entries(objects)) {
                    let dev = interfaces['org.bluez.Device1'];
                    if (!dev) continue;

                    let name = dev.Name?.deep_unpack?.() || 'Unnamed';
                    let address = dev.Address?.deep_unpack?.() || 'No address';
                    let connected = dev.Connected?.deep_unpack?.() ?? false;
                    let rssi = dev.RSSI?.deep_unpack?.();
                    let paired = dev.Paired?.deep_unpack?.() ?? false;

                    let device = {
                        address,
                        name,
                        connected,
                        rssi,
                        visible: true,
                        paired
                    };

                    devices.push(device);

                    allDevices[address] = device
                }

                // update for missing devices
                for (let address of Object.keys(allDevices)) {
                    if (!devices.some(d => d.address === address)) {
                        devices.push({
                            address: address,
                            name: allDevices[address].name,
                            connected: false,
                            rssi: 0,
                            visible: false
                        });

                        // Remove from allDevices if not found
                        delete allDevices[address];
                    }
                }

                resolve(devices);
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
        (conn, sender, path, iface, signal, params) => {
            let [ifaceName, changedProps] = params.deep_unpack();
            if (ifaceName !== 'org.bluez.Device1') return;

            let address = path.split('/').pop().replace(/^dev_/, '').replace(/_/g, ':');
            let changedKeys = Object.keys(changedProps);
            let isConnected = changedProps['Connected']?.deep_unpack?.();
            let rssi = changedProps['RSSI']?.deep_unpack?.();

            logInfo(`DBus PropertiesChanged: ${address} changed=[${changedKeys}] connected=${isConnected} rssi=${rssi}`);

            let device = {
                name: allDevices[address]?.name || 'Unnamed',
                address: address,
                connected: isConnected ?? allDevices[address]?.connected ?? false,
                rssi: rssi ?? allDevices[address]?.rssi,
                visible: true
            }

            allDevices[address] = device

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
        (conn, sender, objectPath, iface, signal, params) => {
            let [removedPath, interfaces] = params.deep_unpack();

            let address = removedPath.split('/').pop().replace(/^dev_/, '').replace(/_/g, ':');
            logInfo(`DBus InterfacesRemoved: ${address} interfaces=[${interfaces}]`);

            if (interfaces.includes('org.bluez.Device1')) {

                delete allDevices[address];

                cb({
                    address: address,
                    connected: false,
                    rssi: 0,
                    visible: false
                });
            }
        }
    );
}

function checkRssiService() {
    rssiServiceAvailable = isRssiServiceAvailable();
    if (!rssiServiceAvailable)
        logInfo(`${RSSI_DBUS_NAME} service not found — RSSI monitoring disabled`);
    return rssiServiceAvailable;
}

function startRssiMonitoring(address, intervalSeconds = 5) {
    if (!rssiServiceAvailable) return;
    DBus.system.call(
        RSSI_DBUS_NAME,
        RSSI_DBUS_PATH,
        'org.gnome.BluetoothRSSI',
        'StartMonitoring',
        new GLib.Variant('(su)', [address, intervalSeconds]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        (conn, res) => {
            try {
                conn.call_finish(res);
                logInfo(`RSSI monitoring started for ${address}`);
            } catch (e) {
                logInfo(`Failed to start RSSI monitoring: ${e.message}`);
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
                logInfo(`RSSI monitoring stopped for ${address}`);
            } catch (e) {
                logInfo(`Failed to stop RSSI monitoring: ${e.message}`);
            }
        }
    );
}

function subscribeRssi(cb) {
    signalSubscribeRssiUpdateId = DBus.system.signal_subscribe(
        RSSI_DBUS_NAME,
        'org.gnome.BluetoothRSSI',
        'RssiUpdate',
        RSSI_DBUS_PATH,
        null,
        Gio.DBusSignalFlags.NONE,
        (conn, sender, path, iface, signal, params) => {
            let [address, rssi] = params.deep_unpack();
            logInfo(`RSSI update: ${address} rssi=${rssi}`);

            if (allDevices[address]) {
                allDevices[address].rssi = rssi;
            }

            cb({ address, rssi });
        }
    );
}

/**
 * Disconnect from all D-Bus signals and clear any active polling.
 */
function disconnect() {
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
}

export default {
    getDevices,
    subscribe,
    checkRssiService,
    subscribeRssi,
    startRssiMonitoring,
    stopRssiMonitoring,
    disconnect
};
