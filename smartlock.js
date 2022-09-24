const { GObject, St } = imports.gi;

const Main = imports.ui.main;
const MainLoop = imports.mainloop;
const ExtensionUtils = imports.misc.extensionUtils;
const GnomeBluetooth = imports.gi.GnomeBluetooth;

const Me = ExtensionUtils.getCurrentExtension();
const { Settings } = Me.imports.settings;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

const DEFAULT_MAC = "70:CE:8C:29:1C:10"

var SmartLock = class SmartLock {
  constructor() {
    this._client = new GnomeBluetooth.Client();
    this._settings = new Settings();
    this._deviceAddress = this._settings.getDevice();
    this._lastSeen = 0;
  }

  _log(message) { log(`[bluetooth-smartlock] ${message}`); }

  _runLoop() {
    const interval = this._settings.getScanInterval();
    this.scan();
    this._loop = MainLoop.timeout_add_seconds(interval, this._runLoop.bind(this));
  }

  lock_screen() {
    Main.overview.hide();
    Main.screenShield.lock(true)
  }

  enable() {
    this._log('Enabling extension');
    this._runLoop();
  }

  disable() {
    this._log('Disabling extension');
    if (this._loop) {
      MainLoop.source_remove(this._loop);
      this._loop = null;
    }
  }

  connect(device) {
    this._client.connect_service(device.get_object_path(), true, null, (source_object, res) => {
      if (this._client.connect_service_finish(res)) {
        this._log("Connected to device");
        this._lastSeen = new Date().getTime();
      }
    });
  }

  scan() {
    // reset last seen if device changed
    if (this._deviceAddress != this._settings.getDevice()) {
      this._log("Device changed");
      this._deviceAddress = this._settings.getDevice();
      this._lastSeen = 0;
    }
    // Screen shield is already locked or not active
    if (Main.screenShield.locked || !this._settings.getActive() || this._deviceAddress == '') { return; }

    try {
      let store = this._client.get_devices();
      let n_items = store.get_n_items();
      for (let i = 0; i < n_items; i++) {
        let device = store.get_item(i);
        //this._log(`device ${device.name} (${device.alias} at ${device.address}) is paired ${device.paired}  connectable ${device.connectable} connected ${device.connected}`);
        if (device.address == this._deviceAddress) {
          let now = new Date().getTime();
          if (!device.connected) {
            // Only check for timeout if  we ever seen device once
            if (this._lastSeen != 0) {
              let duration = (now - this._lastSeen) / 1000;
              if (duration >= this._settings.getAwayDuration() * 60) {
                this._lastSeen = 0;
                this._log(`User stepped away for ${duration} seconds, locking the screen`);
                this.lock_screen();
              }
            }
            // Try to connect to target device, cause Linux wont auto reconnect on some devices like smart phones
            this.connect(device);
          }
          else {
            this._lastSeen = now;
          }
          break;
        }
      }
    } catch (error) {
      this._log(`Error: ${error}`);
    }
  }
}