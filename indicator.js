import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GnomeBluetooth from 'gi://GnomeBluetooth';
import Settings from './settings.js'; // Ensure settings.js is also ESM compatible
// Define your panel indicator button separately
// Register the class and then export it
class SmartlockIndicatorClass extends PanelMenu.Button { // Use a temporary name for the raw class
    constructor() {
        super(0.0, _('Bluetooth Smartlock'));
  
    }

    init(extension, settings){
        this._extension = extension;
        this._client = new GnomeBluetooth.Client();
        this._settings = settings; // Pass settings directly

        const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const iconScheme = interfaceSettings.get_string('color-scheme') === 'prefer-dark' ? 'white' : 'black';

        let icon = new St.Icon({ style_class: 'system-status-icon' });
        icon.gicon = Gio.icon_new_for_string(`${this._extension.path}/icons/smartlock-${iconScheme}.svg`);
        this.add_child(icon);

        // Initial menu item for "Smart Lock" active state
        let activeMenu = new PopupMenu.PopupSwitchMenuItem(_('Smart Lock'), this._settings.getActive());
        activeMenu.connect('activate', (item) => {
            this._settings.setActive(item.state);
        });
        this.menu.addMenuItem(activeMenu);

        this.menu.connect('open-state-changed', this._createMenu.bind(this));
    }

    _createMenu() {
        this.menu.removeAll();

        let activeMenu = new PopupMenu.PopupSwitchMenuItem(_('Smart Lock'), this._settings.getActive());
        activeMenu.connect('activate', (item) => {
            this._settings.setActive(item.state);
        });
        this.menu.addMenuItem(activeMenu);

        let icon = new Gio.ThemedIcon({ name: 'preferences-other-symbolic' });
        let settingsMenu = new PopupMenu.PopupImageMenuItem(_('Settings'), icon);
        settingsMenu.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsMenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Devices')));

        let store = this._client.get_devices();
        let nItems = store.get_n_items();

        if (nItems === 0) {
            let noDevicesItem = new PopupMenu.PopupMenuItem(_('No paired devices found'), { reactive: false });
            this.menu.addMenuItem(noDevicesItem);
        } else {
            for (let i = 0; i < nItems; i++) {
                let device = store.get_item(i);
                if (device.paired && device.name !== '') {
                    let address = device.address;
                    let menuItem = new PopupMenu.PopupSwitchMenuItem(`${device.name}`, this._settings.getDevice() === address);
                    menuItem.connect('activate', () => {
                        this._settings.setDevice(address);
                    });
                    this.menu.addMenuItem(menuItem);
                }
            }
        }
    }

    destroy() {
        if (this._client) {
            this._client = null;
        }
        super.destroy();
    }
}

// Export the registered class
export default GObject.registerClass(
    {
        GTypeName: 'SmartlockIndicator',
        Extends: PanelMenu.Button,
    },
    SmartlockIndicatorClass // Pass the class itself
);