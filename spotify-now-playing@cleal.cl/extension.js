/**
 * Spotify Now Playing — GNOME Shell Extension
 *
 * Layout de la barra:  [ ♫  Artista – Título ][ ▶/⏸ ]
 *
 * Click en el texto   → siguiente pista (Next)
 * Click en el ícono   → alternar play/pausa (PlayPause)
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

export default class SpotifyNowPlayingExtension {
    constructor(metadata) {
        this._metadata            = metadata;
        this._indicator           = null;
        this._songLabel           = null;
        this._playPauseLabel      = null;
        this._proxy               = null;
        this._watcherId           = null;
        this._propertiesChangedId = null;
    }

    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'Spotify Now Playing', true);

        const box = new St.BoxLayout({ style: 'spacing: 2px;' });

        // Zona izquierda: nombre de la canción (click → siguiente)
        this._songLabel = new St.Label({
            text: IDLE_TEXT,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: 'padding: 0 6px 0 6px;',
        });
        this._songLabel.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                this._callMpris('Next');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Zona derecha: ícono play/pausa (click → alterna)
        this._playPauseLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: 'padding: 0 6px 0 2px;',
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
    }

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
