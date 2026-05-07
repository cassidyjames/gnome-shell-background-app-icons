import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const DBUS_NAME = 'org.freedesktop.background.Monitor';
const DBUS_OBJECT_PATH = '/org/freedesktop/background/monitor';

const TOOLTIP_SHOW_TIME = 150;
const TOOLTIP_HIDE_TIME = 100;
const TOOLTIP_HOVER_TIMEOUT = 300;

const BackgroundMonitorIface = `
<node>
  <interface name="org.freedesktop.background.Monitor">
    <property name="BackgroundApps" type="aa{sv}" access="read"/>
    <property name="version" type="u" access="read"/>
  </interface>
</node>`;

const BackgroundMonitorProxy = Gio.DBusProxy.makeProxyWrapper(BackgroundMonitorIface);

Gio._promisify(Gio.DBusConnection.prototype, 'call');

function getSymbolicIcon(app) {
    const icon = app.get_icon();
    if (icon instanceof Gio.ThemedIcon) {
        const names = icon.get_names();
        return Gio.ThemedIcon.new_from_names(
            names.flatMap(n => [`${n}-symbolic`, n]));
    }
    return icon;
}

const BackgroundAppIndicator = GObject.registerClass(
class BackgroundAppIndicator extends PanelMenu.Button {
    _init(app, message) {
        super._init(0.5, app.get_name());

        this._app = app;
        this._showLabelTimeoutId = 0;

        const icon = new St.Icon({
            gicon: getSymbolicIcon(app),
            style_class: 'system-status-icon',
            style: '-st-icon-style: symbolic; padding: 0; margin: 0;',
        });
        const desaturateEffect = new Clutter.DesaturateEffect();
        icon.add_effect(desaturateEffect);
        icon.connect('style-changed', () => {
            const themeNode = icon.get_theme_node();
            desaturateEffect.enabled = themeNode.get_icon_style() === St.IconStyle.SYMBOLIC;
        });
        this.add_child(icon);

        this._label = new St.Label({
            style_class: 'dash-label',
            text: app.get_name(),
        });
        this._label.hide();
        Main.layoutManager.addChrome(this._label);
        this._label.connectObject('destroy', () => (this._label = null), this);

        this.connect('notify::hover', () => this._syncLabel());
        this.menu.connect('open-state-changed', (_, open) => {
            if (open)
                this._hideLabel();
        });
        this.connect('destroy', () => this._onDestroy());

        this.menu.actor.add_style_class_name('app-menu');

        this.menu.addMenuItem(
            new PopupMenu.PopupMenuItem(app.get_name(), {reactive: false}));

        this._statusItem = new PopupMenu.PopupMenuItem(
            message ?? _('Running in the background'),
            {reactive: false});
        this.menu.addMenuItem(this._statusItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const openItem = new PopupMenu.PopupMenuItem(_('Open Window'));
        openItem.connect('activate', () => {
            Main.overview.hide();
            this._app.activate();
        });
        this.menu.addMenuItem(openItem);

        const quitItem = new PopupMenu.PopupMenuItem(_('Quit'));
        quitItem.connect('activate', () => this._quitApp().catch(logError));
        this.menu.addMenuItem(quitItem);
    }

    setMessage(message) {
        this._statusItem.label.set_text(message ?? _('Running in the background'));
    }

    _onDestroy() {
        if (this._showLabelTimeoutId) {
            GLib.source_remove(this._showLabelTimeoutId);
            this._showLabelTimeoutId = 0;
        }
        this._label?.destroy();
    }

    _syncLabel() {
        if (this.hover && !this.menu.isOpen)
            this._showLabel();
        else
            this._hideLabel();
    }

    _showLabel() {
        if (this._showLabelTimeoutId)
            return;

        this._showLabelTimeoutId = GLib.timeout_add_once(
            GLib.PRIORITY_DEFAULT, TOOLTIP_HOVER_TIMEOUT, () => {
                this._showLabelTimeoutId = 0;

                if (!this._label)
                    return;

                const [stageX, stageY] = this.get_transformed_position();
                const itemWidth = this.allocation.get_width();
                const labelWidth = this._label.get_width();
                const xOffset = Math.floor((itemWidth - labelWidth) / 2);
                const x = Math.clamp(stageX + xOffset, 0, global.stage.width - labelWidth);

                const node = this._label.get_theme_node();
                const yOffset = node.get_length('-y-offset');
                const y = stageY + this.height + yOffset;

                this._label.opacity = 0;
                this._label.set_position(x, y);
                this._label.show();
                this._label.ease({
                    opacity: 255,
                    duration: TOOLTIP_SHOW_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
    }

    _hideLabel() {
        if (this._showLabelTimeoutId) {
            GLib.source_remove(this._showLabelTimeoutId);
            this._showLabelTimeoutId = 0;
        }

        this._label?.ease({
            opacity: 0,
            duration: TOOLTIP_HIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._label?.hide(),
        });
    }

    async _quitApp() {
        this.menu.close();
        try {
            await this._app.activate_action('quit', null, 0, -1, null);
        } catch {
            try {
                const appId = this._app.get_id().replace(/\.desktop$/, '');
                Util.trySpawn(['flatpak', 'kill', appId]);
            } catch (e) {
                logError(e, 'Failed to kill application');
            }
        }
    }
});

export default class BackgroundAppIconsExtension extends Extension {
    enable() {
        this._enabled = true;
        this._appSystem = Shell.AppSystem.get_default();
        this._indicators = new Map();

        this._sessionModeChangedId = Main.sessionMode.connect(
            'updated', () => this._syncVisibility());

        new BackgroundMonitorProxy(
            Gio.DBus.session,
            DBUS_NAME,
            DBUS_OBJECT_PATH,
            proxy => {
                if (!this._enabled)
                    return;
                this._proxy = proxy;
                this._proxyChangedId = proxy?.connect(
                    'g-properties-changed', () => this._sync());
                this._sync();
            },
            null,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START);
    }

    disable() {
        this._enabled = false;

        Main.sessionMode.disconnect(this._sessionModeChangedId);
        this._sessionModeChangedId = 0;

        if (this._proxyChangedId) {
            this._proxy?.disconnect(this._proxyChangedId);
            this._proxyChangedId = 0;
        }
        this._proxy = null;

        this._indicators.forEach(indicator => indicator.destroy());
        this._indicators = null;
        this._appSystem = null;
    }

    _sync() {
        if (!this._indicators || !this._proxy)
            return;

        const {BackgroundApps: backgroundApps} = this._proxy;

        const currentApps = new Map();
        (backgroundApps ?? [])
            .map(backgroundApp => {
                const appId = backgroundApp.app_id.deepUnpack();
                const app = this._appSystem.lookup_app(`${appId}.desktop`);
                const message = backgroundApp.message?.deepUnpack() ?? null;
                return {appId, app, message};
            })
            .filter(({app}) => !!app)
            .sort((a, b) => a.app.get_name().localeCompare(b.app.get_name()))
            .forEach(({appId, app, message}) => {
                if (currentApps.has(appId)) {
                    if (message)
                        currentApps.get(appId).message = message;
                } else {
                    currentApps.set(appId, {app, message});
                }
            });

        const toRemove = [...this._indicators.keys()].filter(id => !currentApps.has(id));
        toRemove.forEach(appId => {
            const indicator = this._indicators.get(appId);
            indicator.menu.close();
            indicator.destroy();
            this._indicators.delete(appId);
        });

        const {isLocked} = Main.sessionMode;
        for (const [appId, {app, message}] of currentApps) {
            if (this._indicators.has(appId)) {
                const indicator = this._indicators.get(appId);
                indicator.setMessage(message);
                indicator.visible = !isLocked;
            } else {
                const indicator = new BackgroundAppIndicator(app, message);
                indicator.visible = !isLocked;
                Main.panel.addToStatusArea(
                    `background-app-${appId}`, indicator, 0, 'right');
                this._indicators.set(appId, indicator);
            }
        }
    }

    _syncVisibility() {
        if (!this._indicators)
            return;

        const {isLocked} = Main.sessionMode;
        this._indicators.forEach(indicator => (indicator.visible = !isLocked));
    }
}
