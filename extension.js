/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const {Settings} = Me.imports.settings;
const {SmartLock} = Me.imports.smartlock;
const {Indicator} = Me.imports.indicator;

class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        this._indicatorChangeHandlerId = 0;
    }

    enable() {
        this._indicator = new Indicator();
        this._settings = new Settings();
        Main.panel.addToStatusArea(this._uuid, this._indicator);

        // Set default state when extension enabled
        if (this._settings.getHideIndicator())
            Main.panel.statusArea[this._uuid].hide();

        // Listen for indicator setting change
        this._indicatorChangeSignal = this._settings._settings.connect('changed::indicator', () => {
            if (this._settings.getHideIndicator())
                Main.panel.statusArea[this._uuid].hide();
            else
                Main.panel.statusArea[this._uuid].show();
        });

        this._smartLock = new SmartLock();
        this._smartLock.enable();
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;

        if (this._indicatorChangeHandlerId)
            this._settings._settings.disconnect(this._indicatorChangeHandlerId);

        this._settings = null;

        this._smartLock.disable();
        this._smartLock = null;
    }
}

/**
 * Steps to run on initialization of the extension
 *
 * @param {Extension} meta The extension
 */
function init(meta) {
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
    return new Extension(meta.uuid);
}
