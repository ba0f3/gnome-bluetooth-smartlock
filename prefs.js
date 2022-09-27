'use strict';

const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;

// It's common practice to keep GNOME API and JS imports in separate blocks
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {Settings} = Me.imports.settings;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
/**
 * Steps to run on initialization of preferenences dialog
 */
// eslint-disable-next-line no-unused-vars
function init() {
    log(`[bluetooth-smartlock] Initializing ${Me.metadata.name} Preferences`);
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
}

class SettingsBuilder {
    constructor() {
        this._settings = new Settings()._settings;
        this._builder = new Gtk.Builder();
    }

    build() {
        this._builder.add_from_file(`${Me.path}/settings.ui`);
        this._container = this._builder.get_object('container');
        this._builder.get_object('advanced_button').connect('clicked', () => {
            let dialog = new Gtk.Dialog({
                title: _('Advanced Settings'),
                transient_for: this._container.get_ancestor(Gtk.Window),
                use_header_bar: true,
                modal: true,
            });
            let box = this._builder.get_object('advanced_settings');
            dialog.get_content_area().append(box);

            dialog.connect('response', () => {
                dialog.get_content_area().remove(box);
                dialog.destroy();
            });
            dialog.show();
        });

        this._settings.bind('active', this._builder.get_object('active_switch'), 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('indicator', this._builder.get_object('hide_indicator_switch'), 'active', Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('interval', this._builder.get_object('scan_interval'), 'value', Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('duration-in-seconds', this._builder.get_object('duration'), 'value', Gio.SettingsBindFlags.DEFAULT);


        return this._container;
    }
}

/**
 * Build prefernces widget
 */
// eslint-disable-next-line no-unused-vars
function buildPrefsWidget() {
    let settings = new SettingsBuilder();
    let widget = settings.build();

    return widget;
}
