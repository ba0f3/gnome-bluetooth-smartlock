import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';

import { isRssiServiceAvailable, RSSI_DBUS_NAME, RSSI_DBUS_PATH } from './bluetooth/rssi-service.js';
import { logInfo, logWarn } from './log.js';

// ExtensionPreferences is the base class for GTK4 preference windows
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Removed: No need for a separate 'Settings' wrapper in prefs.js as this.getSettings() is provided.
// Removed: The 'metadata' variable is also not needed globally; it's available as this.metadata.

/**
 * MyExtensionPreferences class handles the creation and management
 * of the extension's preferences window using GTK4 and Adwaita.
 * It extends ExtensionPreferences, which provides useful methods
 * like getSettings() and access to this.metadata.
 */
export default class MyExtensionPreferences extends ExtensionPreferences {
    /**
     * This method is called by the Gnome Shell preferences system
     * to populate the preferences window.
     * @param {Adw.PreferencesWindow} window The main preferences window.
     */
    fillPreferencesWindow(window) {
        // Get the Gio.Settings object for this extension.
        // ExtensionPreferences provides this method, automatically linking
        // to your extension's GSettings schema based on its UUID.
        this._settings = this.getSettings();
        const rssiAvailable = isRssiServiceAvailable();

        // Create a Gtk.Builder to load the UI from your settings.ui file.
        const builder = new Gtk.Builder();
        // Use this.metadata.path to get the correct path to your extension's directory.
        builder.add_from_file(GLib.build_filenamev([this.metadata.path, 'settings.ui']));

        // Get the main container widget defined in your settings.ui file.
        const container = builder.get_object('container');

        // Adwaita preferences windows are structured with Adw.PreferencesPage
        // and Adw.PreferencesGroup. Your 'container' (e.g., a GtkBox)
        // should be placed inside an Adw.PreferencesGroup.
        const generalSettingsGroup = new Adw.PreferencesGroup({
            title: this.gettext('General Settings'),
            description: this.gettext('Basic settings for the extension.'),
        });
        generalSettingsGroup.add(container); // Add your UI container to the group

        const mainPage = new Adw.PreferencesPage();
        mainPage.add(generalSettingsGroup); // Add the group to a preferences page
        window.add(mainPage); // Add the page to the main preferences window

        // Connect the 'advanced_button' signal.
        builder.get_object('advanced_button').connect('clicked', () => {
            // Create a new Gtk.Dialog instance for advanced settings.
            const dialog = new Gtk.Dialog({
                title: this.gettext('Advanced Settings'),
                use_header_bar: true, // Gtk.Dialog in GTK4 defaults to using a HeaderBar
                modal: true,         // Make the dialog modal
            });

            // Set the transient parent for the dialog.
            // get_root() is the GTK4 way to get the top-level window.
            const parentWindow = container.get_root();
            if (parentWindow instanceof Gtk.Window) {
                dialog.set_transient_for(parentWindow);
            } else {
                logWarn("Could not find a Gtk.Window parent for the preferences dialog.");
            }

            // Get the 'advanced_settings' box from the builder.
            // IMPORTANT: If 'advanced_settings' is already a child of 'container'
            // in your settings.ui, moving it will remove it from the main preferences view.
            // For dialogs, it's often better to define the dialog content as a separate
            // top-level widget in your .ui file, or create new widgets dynamically.
            const advancedSettingsBox = builder.get_object('advanced_settings');

            // If the box has a parent (meaning it's currently part of another layout),
            // remove it before appending to the dialog.
            if (advancedSettingsBox.get_parent()) {
                advancedSettingsBox.get_parent().remove(advancedSettingsBox);
            }
            // Append the advanced settings box to the dialog's content area.
            dialog.get_content_area().append(advancedSettingsBox);

            // Live RSSI reading — subscribe to signals while dialog is open.
            // StartMonitoring is idempotent: if the extension already started it,
            // this is a no-op. We never call StopMonitoring to avoid interfering
            // with the extension's monitor — the service's idle timeout handles cleanup.
            let rssiSignalId = null;
            const rssiRow = builder.get_object('rssi_reading_row');
            const rssiValue = builder.get_object('rssi_reading_value');
            const targetDevice = this._settings.get_string('mac');

            if (rssiAvailable && targetDevice) {
                rssiRow.visible = true;
                const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);

                rssiSignalId = bus.signal_subscribe(
                    RSSI_DBUS_NAME,
                    RSSI_DBUS_NAME,
                    'RssiUpdate',
                    RSSI_DBUS_PATH,
                    null,
                    Gio.DBusSignalFlags.NONE,
                    (_conn, _sender, _path, _iface, _signal, params) => {
                        const [address, rssi] = params.deep_unpack();
                        logInfo(`prefs RSSI: ${address} rssi=${rssi}`);
                        if (address === targetDevice)
                            rssiValue.label = `${rssi} dBm`;
                    }
                );

                bus.call(
                    RSSI_DBUS_NAME,
                    RSSI_DBUS_PATH,
                    RSSI_DBUS_NAME,
                    'StartMonitoring',
                    new GLib.Variant('(su)', [targetDevice, 2]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (conn, res) => {
                        try {
                            conn.call_finish(res);
                            logInfo(`prefs StartMonitoring OK for ${targetDevice}`);
                        } catch (e) {
                            logInfo(`prefs StartMonitoring failed: ${e.message}`);
                            rssiValue.label = this.gettext('unavailable');
                        }
                    }
                );
            }

            // Connect to the 'response' signal to clean up when the dialog is closed.
            dialog.connect('response', () => {
                if (rssiSignalId !== null) {
                    const bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
                    bus.signal_unsubscribe(rssiSignalId);
                }

                dialog.get_content_area().remove(advancedSettingsBox);
                dialog.close();
            });

            // Show the dialog.
            dialog.show();
        });

        // Bind the GSettings keys to the properties of the UI widgets.
        // Use this._settings as the Gio.Settings object.
        this._settings.bind(
            'active',
            builder.get_object('active_switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'indicator',
            builder.get_object('hide_indicator_switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'auto-unlock',
            builder.get_object('auto_unlock_switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'duration-in-seconds',
            builder.get_object('duration'),
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'proximity-lock',
            builder.get_object('proximity_lock_switch'),
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'rssi-threshold',
            builder.get_object('rssi_threshold'),
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Disable RSSI controls if the bt-rssi service is not installed.
        // Must run after settings.bind() which resets widget state.
        if (!rssiAvailable) {
            const tooltip = this.gettext('bt-rssi service is not installed');
            for (const id of ['proximity_lock', 'rssi_threshold']) {
                const widget = builder.get_object(id === 'proximity_lock' ? 'proximity_lock_switch' : 'rssi_threshold');
                const label = builder.get_object(`${id}_label`);
                const icon = builder.get_object(`${id}_icon`);
                widget.sensitive = false;
                widget.tooltip_text = tooltip;
                label.tooltip_text = tooltip;
                icon.visible = true;
                icon.tooltip_text = tooltip;
            }
        }
    }
}
