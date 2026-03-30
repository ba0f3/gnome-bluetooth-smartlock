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

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import Settings from './settings.js';
import SmartLock from './smartlock.js';
import Indicator from './indicator.js';

export default class BluetoothSmartLockExtension extends Extension {
    constructor(metadata) {
        super(metadata); 
        this.metadata = metadata;
    }

    async enable() {
        this._settings = Settings;
        this._settings.init(this.getSettings());

        this._indicator = new Indicator();
        this._indicator.init(this, this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        if (this._settings.getHideIndicator())
            Main.panel.statusArea[this.uuid].hide();

        this._indicatorChangeSignal = this._settings.connectIndicatorChangeSignal((hide) => {
            if (hide)
                Main.panel.statusArea[this.uuid].hide();
            else
                Main.panel.statusArea[this.uuid].show();
        });

        this._sessionModeSignal = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.currentMode === 'unlock-dialog')
                this._indicator.hide();
            else if (!this._settings.getHideIndicator())
                this._indicator.show();
        });

        this._smartLock = new SmartLock(this._settings);
        await this._smartLock.enable();
        
        this._settings.connectDeviceChangeSignal(async () => await this._smartLock.checkNow());

    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;

        if (this._indicatorChangeSignal)
            this._settings.disconnect(this._indicatorChangeSignal);

        if (this._sessionModeSignal)
            Main.sessionMode.disconnect(this._sessionModeSignal);
            

        this._settings = null;

        this._smartLock.disable();
        this._smartLock = null;
    }
}
