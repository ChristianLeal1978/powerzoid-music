/**
 * Spotify Now Playing — GNOME Shell Extension
 * Shows the current track and artist from Spotify in the top bar.
 * Click the label to skip to the next track.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const SPOTIFY_BUS_NAME   = 'org.mpris.MediaPlayer2.spotify';
const MPRIS_OBJECT_PATH  = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const MAX_TEXT_LENGTH = 50;
const IDLE_TEXT       = '♫';

const STATUS_ICONS = {
    'Playing': '▶',
    'Paused' : '⏸',
    'Stopped': '⏹',
};

export default class SpotifyNowPlayingExtension {
    constructor(metadata) {
        this._metadata            = metadata;
        this._indicator           = null;
        this._label               = null;
        this._proxy               = null;
        this._watcherId           = null;
        this._propertiesChangedId = null;
        this._clickHandlerId      = null;
    }

    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'Spotify Now Playing', true);

        this._label = new St.Label({
            text: IDLE_TEXT,
            y_align: Clutter.ActorAlign.CENTER,
            // No font-size: inherits the shell theme font
            style: 'padding: 0 6px;',
        });

        this._indicator.add_child(this._label);

        // Click → next track
        this._clickHandlerId = this._indicator.connect(
            'button-press-event',
            (_actor, event) => {
                // Left click only
                if (event.get_button() === 1) {
                    this._skipToNext();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
        );

        // Left side of the panel
        Main.panel.addToStatusArea('spotify-now-playing', this._indicator, 1, 'left');

        this._startWatching();
    }

    disable() {
        this._stopWatching();

        if (this._indicator) {
            if (this._clickHandlerId !== null) {
                this._indicator.disconnect(this._clickHandlerId);
                this._clickHandlerId = null;
            }
            this._indicator.destroy();
            this._indicator = null;
        }
        this._label = null;
    }

    // ── D-Bus watcher ────────────────────────────────────────────────────────

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

    // ── Proxy management ─────────────────────────────────────────────────────

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
        this._setLabel(IDLE_TEXT);
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

    // ── MPRIS2 actions ───────────────────────────────────────────────────────

    _skipToNext() {
        if (!this._proxy) return;
        this._proxy.call(
            'Next',
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (e) {
                    console.error(`[spotify-now-playing] Next failed: ${e.message}`);
                }
            }
        );
    }

    // ── Property change handler ───────────────────────────────────────────────

    _onPropertiesChanged(_proxy, changed, _invalidated) {
        try {
            const props = changed.recursiveUnpack();
            if ('Metadata' in props || 'PlaybackStatus' in props)
                this._updateDisplay();
        } catch (e) {
            console.error(`[spotify-now-playing] PropertiesChanged error: ${e.message}`);
        }
    }

    // ── Display update ────────────────────────────────────────────────────────

    _updateDisplay() {
        if (!this._proxy || !this._label) return;

        try {
            const statusVariant   = this._proxy.get_cached_property('PlaybackStatus');
            const metadataVariant = this._proxy.get_cached_property('Metadata');

            if (!metadataVariant) {
                this._setLabel(IDLE_TEXT);
                return;
            }

            const metadata  = metadataVariant.recursiveUnpack();
            const title     = metadata['xesam:title'] ?? '–';
            const artistRaw = metadata['xesam:artist'];
            const artist    = Array.isArray(artistRaw)
                ? artistRaw.join(', ')
                : (artistRaw ?? '–');

            const status = statusVariant ? statusVariant.unpack() : 'Stopped';
            const icon   = STATUS_ICONS[status] ?? '♫';

            let text = `${artist} – ${title}`;
            if (text.length > MAX_TEXT_LENGTH)
                text = text.slice(0, MAX_TEXT_LENGTH - 1) + '…';

            this._setLabel(`${icon}  ${text}`);
        } catch (e) {
            console.error(`[spotify-now-playing] Display update error: ${e.message}`);
            this._setLabel(IDLE_TEXT);
        }
    }

    _setLabel(text) {
        if (this._label)
            this._label.set_text(text);
    }
}
