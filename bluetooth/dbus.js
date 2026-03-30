import GLib from 'gi://GLib';
const DBus = imports.gi.Gio.DBus;
const Gio = imports.gi.Gio;

let signalSubscribePropertiesChangedId = null;
let signalSubscribeInterfacesRemovedId = null;
let btPollTimeoutId = null;
let pollLock = false;
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
 * Subscibe to device changes via D-Bus signals.
 * TODO: this does not handle devices that are removed from the system well
 * @param {*} cb 
 * @returns 
 */
function subscribe(cb) {
    disconnect()
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
            let isConnected = changedProps['Connected']?.deep_unpack?.();
            let rssi = changedProps['RSSI']?.deep_unpack?.(); // RSSI might not be present, handle it gracefully

            let device = {
                name: allDevices[address]?.name || 'Unnamed',
                address: address,
                connected: isConnected,
                rssi: rssi,
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

/**
 * Disconnect from all D-Bus signals and clear any active polling.
 */
function disconnect() {
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
    disconnect
};