const GnomeBluetooth = imports.gi.GnomeBluetooth;
let client = null;

function getClient() {
    if (!client) {
        client = new GnomeBluetooth.Client();
    }
    return client;
}


let allDevices = {};
/**
 * Get a list of Bluetooth devices managed by BlueZ.
 * @returns 
 */
async function getDevices() {

    let result = [];
    let store = getClient().get_devices();
    let nIitems = store.get_n_items();
    
    for (let i = 0; i < nIitems; i++) {
        let device = store.get_item(i);

        let address = device.address;
        let name = device.name || 'Unnamed';
        let connected = device.connected;
        let rssi = device.rssi;
        let paired = device.paired;

        const newDevice = {
            address,
            name,
            connected,
            rssi,
            visible: true,
            paired
        };

        allDevices[address] = newDevice;
        result.push(newDevice);

    }

    // update for missing devices
    for (let address of Object.keys(allDevices)) {
        if (!result.some(d => d.address === address)) {
            result.push({
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

    return result;
}

/**
 * Disconnect from all D-Bus signals and clear any active polling.
 */
function disconnect() {

}

function connect(targetAddress){
    let devices = getClient().get_devices();
    let device = devices.find(d => d.get_address() === targetAddress);

    if (device) {
        device.connect_async(null, (obj, res) => {
            try {
                obj.connect_finish(res);
            } catch (e) {
                // do nothing, we don't care about errors
            }
        });
    } 
}

export default {
    getDevices,
    disconnect,
    connect
};