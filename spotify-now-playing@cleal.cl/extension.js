/**
 * Spotify Now Playing — GNOME Shell Extension
 *
 * Layout de la barra:  [ ♫  Artista – Título ][ ▶/⏸ ]
 *
 * Click izquierdo en texto   → siguiente pista (Next)
 * Click derecho en texto     → menú: tamaño de letra
 * Click en el ícono          → alternar play/pausa (PlayPause)
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SPOTIFY_BUS_NAME    = 'org.mpris.MediaPlayer2.spotify';
const MPRIS_OBJECT_PATH   = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE  = 'org.mpris.MediaPlayer2.Player';

const MAX_TEXT_LENGTH     = 50;
const IDLE_TEXT           = '♫';
const DEFAULT_FONT_SIZE   = 13;
const MIN_FONT_SIZE       = 8;
const MAX_FONT_SIZE       = 20;

export default class SpotifyNowPlayingExtension {
    constructor(metadata) {
        this._metadata            = metadata;
        this._indicator           = null;
        this._songLabel           = null;
        this._playPauseLabel      = null;
        this._proxy               = null;
        this._watcherId           = null;
        this._propertiesChangedId = null;
        this._fontSize            = DEFAULT_FONT_SIZE;
        this._fontSizeItem        = null;
    }

    enable() {
        this._loadSettings();

        // false → PanelMenu crea el menú popup automáticamente
        this._indicator = new PanelMenu.Button(0.0, 'Spotify Now Playing', false);

        const box = new St.BoxLayout({ style: 'spacing: 2px;' });

        // Zona izquierda: nombre de la canción
        // Click izquierdo → siguiente pista | Click derecho → menú
        this._songLabel = new St.Label({
            text: IDLE_TEXT,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: this._labelStyle(),
        });
        this._songLabel.connect('button-press-event', (_actor, event) => {
            const button = event.get_button();
            if (button === 1) {
                this._callMpris('Next');
                return Clutter.EVENT_STOP;
            }
            if (button === 3) {
                this._indicator.menu.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Zona derecha: ícono play/pausa (click → alterna)
        this._playPauseLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: this._playPauseStyle(),
        });
        this._playPauseLabel.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                this._callMpris('PlayPause');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        box.add_child(this._songLabel);
        box.add_child(this._playPauseLabel);
        this._indicator.add_child(box);

        this._buildMenu();

        Main.panel.addToStatusArea('spotify-now-playing', this._indicator, 1, 'left');

        this._startWatching();
    }

    disable() {
        this._stopWatching();

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._songLabel      = null;
        this._playPauseLabel = null;
        this._fontSizeItem   = null;
    }

    // ─── Menú contextual ───────────────────────────────────────────────────────

    _buildMenu() {
        // Ítem informativo: tamaño actual (no clickeable)
        this._fontSizeItem = new PopupMenu.PopupMenuItem(
            this._fontSizeLabel(), { reactive: false }
        );
        this._fontSizeItem.label.set_style('color: #aaa; font-style: italic;');
        this._indicator.menu.addMenuItem(this._fontSizeItem);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const increaseItem = new PopupMenu.PopupMenuItem('A+   Aumentar letra');
        increaseItem.connect('activate', () => this._changeFontSize(1));
        this._indicator.menu.addMenuItem(increaseItem);

        const decreaseItem = new PopupMenu.PopupMenuItem('A−   Reducir letra');
        decreaseItem.connect('activate', () => this._changeFontSize(-1));
        this._indicator.menu.addMenuItem(decreaseItem);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const resetItem = new PopupMenu.PopupMenuItem('↺    Restablecer');
        resetItem.connect('activate', () => {
            this._fontSize = DEFAULT_FONT_SIZE;
            this._applyFontSize();
            this._saveSettings();
        });
        this._indicator.menu.addMenuItem(resetItem);
    }

    _fontSizeLabel() {
        return `Tamaño: ${this._fontSize} px`;
    }

    _changeFontSize(delta) {
        this._fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, this._fontSize + delta));
        this._applyFontSize();
        this._saveSettings();
    }

    _applyFontSize() {
        this._songLabel?.set_style(this._labelStyle());
        this._playPauseLabel?.set_style(this._playPauseStyle());
        this._fontSizeItem?.label.set_text(this._fontSizeLabel());
    }

    _labelStyle() {
        return `padding: 0 6px 0 6px; font-size: ${this._fontSize}px;`;
    }

    _playPauseStyle() {
        return `padding: 0 6px 0 2px; font-size: ${this._fontSize}px;`;
    }

    // ─── Persistencia ──────────────────────────────────────────────────────────

    _settingsPath() {
        return GLib.build_filenamev([
            GLib.get_user_config_dir(), 'spotify-now-playing-gnome', 'settings.json'
        ]);
    }

    _loadSettings() {
        try {
            const file = Gio.File.new_for_path(this._settingsPath());
            const [ok, contents] = file.load_contents(null);
            if (ok) {
                const data = JSON.parse(new TextDecoder().decode(contents));
                this._fontSize = Number.isInteger(data.fontSize) ? data.fontSize : DEFAULT_FONT_SIZE;
            }
        } catch (_e) {
            this._fontSize = DEFAULT_FONT_SIZE;
        }
    }

    _saveSettings() {
        try {
            const dir = GLib.path_get_dirname(this._settingsPath());
            GLib.mkdir_with_parents(dir, 0o755);
            const file = Gio.File.new_for_path(this._settingsPath());
            const data = new TextEncoder().encode(JSON.stringify({ fontSize: this._fontSize }));
            file.replace_contents(
                data, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            console.error(`[spotify-now-playing] Settings save failed: ${e.message}`);
        }
    }

    // ─── D-Bus / MPRIS ─────────────────────────────────────────────────────────

    _startWatching() {
        this._watcherId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            SPOTIFY_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            this._onSpotifyAppeared.bind(this),
            this._onSpotifyVanished.bind(this)
        );
    }

    _stopWatching() {
        this._destroyProxy();
        if (this._watcherId !== null) {
            Gio.bus_unwatch_name(this._watcherId);
            this._watcherId = null;
        }
    }

    _onSpotifyAppeared(_connection, _name, _nameOwner) {
        Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.NONE,
            null,
            SPOTIFY_BUS_NAME,
            MPRIS_OBJECT_PATH,
            MPRIS_PLAYER_IFACE,
            null,
            (source, result) => {
                try {
                    this._proxy = Gio.DBusProxy.new_finish(result);
                    this._propertiesChangedId = this._proxy.connect(
                        'g-properties-changed',
                        this._onPropertiesChanged.bind(this)
                    );
                    this._updateDisplay();
                } catch (e) {
                    console.error(`[spotify-now-playing] Proxy init failed: ${e.message}`);
                }
            }
        );
    }

    _onSpotifyVanished(_connection, _name) {
        this._destroyProxy();
        this._songLabel?.set_text(IDLE_TEXT);
        this._playPauseLabel?.set_text('');
    }

    _destroyProxy() {
        if (this._proxy) {
            if (this._propertiesChangedId !== null) {
                this._proxy.disconnect(this._propertiesChangedId);
                this._propertiesChangedId = null;
            }
            this._proxy = null;
        }
    }

    _callMpris(method) {
        if (!this._proxy) return;
        this._proxy.call(
            method,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (proxy, result) => {
                try { proxy.call_finish(result); }
                catch (e) { console.error(`[spotify-now-playing] ${method} failed: ${e.message}`); }
            }
        );
    }

    _onPropertiesChanged(_proxy, changed, _invalidated) {
        try {
            const props = changed.recursiveUnpack();
            if ('Metadata' in props || 'PlaybackStatus' in props)
                this._updateDisplay();
        } catch (e) {
            console.error(`[spotify-now-playing] PropertiesChanged error: ${e.message}`);
        }
    }

    _updateDisplay() {
        if (!this._proxy || !this._songLabel || !this._playPauseLabel) return;

        try {
            const statusVariant   = this._proxy.get_cached_property('PlaybackStatus');
            const metadataVariant = this._proxy.get_cached_property('Metadata');

            if (!metadataVariant) {
                this._songLabel.set_text(IDLE_TEXT);
                this._playPauseLabel.set_text('');
                return;
            }

            const metadata  = metadataVariant.recursiveUnpack();
            const title     = metadata['xesam:title'] ?? '–';
            const artistRaw = metadata['xesam:artist'];
            const artist    = Array.isArray(artistRaw)
                ? artistRaw.join(', ')
                : (artistRaw ?? '–');

            const status        = statusVariant ? statusVariant.unpack() : 'Stopped';
            const playPauseIcon = status === 'Playing' ? '⏸' : '▶';
            this._playPauseLabel.set_text(playPauseIcon);

            let text = `♫  ${artist} – ${title}`;
            if (text.length > MAX_TEXT_LENGTH)
                text = text.slice(0, MAX_TEXT_LENGTH - 1) + '…';
            this._songLabel.set_text(text);

        } catch (e) {
            console.error(`[spotify-now-playing] Display update error: ${e.message}`);
            this._songLabel?.set_text(IDLE_TEXT);
            this._playPauseLabel?.set_text('');
        }
    }
}
