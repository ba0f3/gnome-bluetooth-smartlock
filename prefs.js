import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw'; // Import Adwaita for modern GNOME UI
const { gettext: _ } = imports.gettext;

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
            title: _('General Settings'),
            description: _('Basic settings for the extension.'),
        });
        generalSettingsGroup.add(container); // Add your UI container to the group

        const mainPage = new Adw.PreferencesPage();
        mainPage.add(generalSettingsGroup); // Add the group to a preferences page
        window.add(mainPage); // Add the page to the main preferences window

        // Connect the 'advanced_button' signal.
        builder.get_object('advanced_button').connect('clicked', () => {
            // Create a new Gtk.Dialog instance for advanced settings.
            const dialog = new Gtk.Dialog({
                title: _('Advanced Settings'),
                use_header_bar: true, // Gtk.Dialog in GTK4 defaults to using a HeaderBar
                modal: true,         // Make the dialog modal
            });

            // Set the transient parent for the dialog.
            // get_root() is the GTK4 way to get the top-level window.
            const parentWindow = container.get_root();
            if (parentWindow instanceof Gtk.Window) {
                dialog.set_transient_for(parentWindow);
            } else {
                console.warn("Could not find a Gtk.Window parent for the preferences dialog.");
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

            // Connect to the 'response' signal to clean up when the dialog is closed.
            dialog.connect('response', () => {
                // Remove the box from the dialog's content area.
                dialog.get_content_area().remove(advancedSettingsBox);
                // Destroy the advanced settings box and its children.
                advancedSettingsBox.destroy();
                // Destroy the dialog itself.
                dialog.destroy();
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
            'interval',
            builder.get_object('scan_interval'),
            'value', // Gtk.SpinButton uses 'value'
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'duration-in-seconds',
            builder.get_object('duration'),
            'value', // Gtk.SpinButton uses 'value'
            Gio.SettingsBindFlags.DEFAULT
        );
    }
}
