const { GObject, St } = imports.gi;

const Gio = imports.gi.Gio;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const ExtensionUtils = imports.misc.extensionUtils;
const GnomeBluetooth = imports.gi.GnomeBluetooth;

const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const { Settings } = Me.imports.settings;
const _ = Gettext.gettext;


var Indicator = GObject.registerClass(
  class Indicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _('Bluetooth Smartlock'));
      this._client = new GnomeBluetooth.Client();
      this._settings = new Settings();

      let icon = new St.Icon({ style_class: 'system-status-icon' });
      icon.gicon = Gio.icon_new_for_string(`${Me.path}/icons/smartlock-white.svg`);
      this.add_child(icon);

      let active_menu = new PopupMenu.PopupSwitchMenuItem(_('Active'), this._settings.getActive());
      active_menu.connect('activate', (self) => {
        this._settings.setActive(self.state);
      });
      this.menu.addMenuItem(active_menu);

      this.menu.connect('open-state-changed', this.addDevices.bind(this));
    }

    addDevices() {
      this.menu.removeAll();
      let active_menu = new PopupMenu.PopupSwitchMenuItem(_('Active'), this._settings.getActive());
      active_menu.connect('activate', (self) => {
        this._settings.setActive(self.state);
      });
      this.menu.addMenuItem(active_menu);

      let settings_menu = new PopupMenu.PopupMenuItem(_('Settings'));
      settings_menu.connect('activate', () => {
        Util.spawn(['gnome-extensions', 'prefs', Me.metadata['uuid']]);
      });
      this.menu.addMenuItem(settings_menu);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      let store = this._client.get_devices();
      let n_items = store.get_n_items();
      for (let i = 0; i < n_items; i++) {
        let device = store.get_item(i);
        if (device.paired && device.name != '') {
          let address = device.address;
          let menu = new PopupMenu.PopupSwitchMenuItem(`${device.name}`, this._settings.getDevice() == address);
          menu.connect('activate', (self) => {
            this._settings.setDevice(address);
          });
          this.menu.addMenuItem(menu);
        }
      }
    }
  });
