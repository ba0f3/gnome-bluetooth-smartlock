import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import bluetooth from "./bluetooth/dbus.js";
import { extErr } from './log.js';

class SmartlockIndicatorClass extends PanelMenu.Button { // Use a temporary name for the raw class
    constructor() {
        super(0.0, _('Bluetooth Smartlock'));

    }

    init(extension, settings) {
        this._extension = extension;
        this._settings = settings; // Pass settings directly

        const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        const iconScheme = interfaceSettings.get_string('color-scheme') === 'prefer-dark' ? 'white' : 'black';

        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string('system-lock-screen-symbolic'),
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._createMenu();
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) this._createMenu();
        });

        this._lastSeenSignal = this._settings.connectLastSeenChangeSignal(() => this._setIconColor(icon));
        this._activeSignal = this._settings.connectActiveSignal(() => this._setIconColor(icon));
        this._deviceChangeSignal = this._settings.connectDeviceChangeSignal(() => this._setIconColor(icon));

        this._setIconColor(icon);
    }

    _setIconColor(icon) {
        if (!this._settings.getActive()) {
            icon.set_style(null);
            return;
        }

        if (!this._settings.getDevice()) {
            icon.set_style(null);
            return;
        }

        if (this._settings.getLastSeen()) {
            icon.style = `color: #00FF00;`; // Green if last seen is recent
        } else {
            icon.style = `color: #FF0000;`; // Red if not seen recently
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._lastSeenSignal)
            this._settings.disconnect(this._lastSeenSignal);
        if (this._activeSignal)
            this._settings.disconnect(this._activeSignal);
        if (this._deviceChangeSignal)
            this._settings.disconnect(this._deviceChangeSignal);
        super.destroy();
    }

    async _createMenu() {
        if (this._creatingMenu || this._destroyed) return;
        this._creatingMenu = true;

        try {
            this.menu.removeAll();

            const devices = await bluetooth.getDevices();
            if (this._destroyed)
                return;

            devices.sort((a, b) => a.name.localeCompare(b.name));

            for (const device of devices) {
                if (device.paired && device.name !== '') {
                    let address = device.address;
                    let menuItem = new PopupMenu.PopupSwitchMenuItem(`${device.name}`, this._settings.getDevice() === address);
                    menuItem.connect('activate', () => {
                        this._settings.setDevice(address);
                    });
                    this.menu.addMenuItem(menuItem);
                }
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            let activeMenu = new PopupMenu.PopupSwitchMenuItem(_('Enable Smart Lock'), this._settings.getActive());
            activeMenu.connect('activate', (item) => {
                this._settings.setActive(item.state);
            });
            this.menu.addMenuItem(activeMenu);

            let icon = new Gio.ThemedIcon({ name: 'preferences-other-symbolic' });
            let settingsMenu = new PopupMenu.PopupImageMenuItem(_('Settings'), icon);
            // openPreferences() returns undefined and does not propagate
            // the Promise from the internal promisified DBus call, causing
            // an unhandled rejection warning when the prefs window is
            // already open. Calling the DBus method directly avoids this.
            // this._extension.openPreferences();
            settingsMenu.connect('activate', () => {
                Gio.DBus.session.call(
                    'org.gnome.Shell.Extensions',
                    '/org/gnome/Shell/Extensions',
                    'org.gnome.Shell.Extensions',
                    'OpenExtensionPrefs',
                    new GLib.Variant('(ssa{sv})', [this._extension.uuid, '', {}]),
                    null, Gio.DBusCallFlags.NONE, -1, null)
                .catch(() => {});
            });
            this.menu.addMenuItem(settingsMenu);
        } catch (e) {
            if (!this._destroyed)
                extErr('Failed to build Bluetooth Smartlock menu', e);
        } finally {
            this._creatingMenu = false;
        }
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
