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

const { GObject, St } = imports.gi;

const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const { Settings } = Me.imports.settings;
const { SmartLock } = Me.imports.smartlock;
const { Indicator } = Me.imports.indicator;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;


class Extension {
  constructor(uuid) {
    this._uuid = uuid;
    this._settings = new Settings();
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
  }

  enable() {
    this._indicator = new Indicator();
    Main.panel.addToStatusArea(this._uuid, this._indicator);

    if (this._settings.getHideIndicator()) {
      Main.panel.statusArea[this._uuid].hide();
    }

    this._smartLock = new SmartLock();
    this._smartLock.enable();
  }

  disable() {
    if (this._indicator != null) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._smartLock.disable();
    this._smartLock = null;
  }
}

function init(meta) {
  return new Extension(meta.uuid);
}