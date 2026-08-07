/**
 * Spotify Now Playing — GNOME Shell Extension
 *
 * Layout de la barra:  [ ♫  Artista – Título ]
 *
 * Click izquierdo en texto   → siguiente pista (Next)
 * Click derecho en texto     → menú: tamaño de letra
 * Hover sobre la extensión   → panel con carátula, artista, título,
 *                               duración y progreso de la canción
 * Click en la carátula       → alternar play/pausa (PlayPause)
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

const POPUP_WIDTH          = 220;
const POPUP_ART_SIZE       = 192;
const POPUP_TEXT_MAX_LEN   = 40;
const PROGRESS_BAR_WIDTH   = 200;
const PROGRESS_UPDATE_MS   = 1000;
const HOVER_HIDE_DELAY_MS  = 150;

const ART_CACHE_DIR = GLib.build_filenamev([
    GLib.get_user_cache_dir(), 'spotify-now-playing-gnome'
]);

function _debugMarker(tag) {
    try {
        const file = Gio.File.new_for_path('/tmp/spotify_debug_marker.txt');
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        stream.write(`${GLib.DateTime.new_now_local().format('%H:%M:%S')} ${tag}\n`, null);
        stream.close(null);
    } catch (e) { /* ignore */ }
}

export default class SpotifyNowPlayingExtension {
    constructor(metadata) {
        _debugMarker('constructor');
        this._metadata            = metadata;
        this._indicator           = null;
        this._songLabel           = null;
        this._proxy               = null;
        this._watcherId           = null;
        this._propertiesChangedId = null;
        this._fontSize            = DEFAULT_FONT_SIZE;
        this._fontSizeItem        = null;

        // Popup de hover
        this._popup               = null;
        this._popupCoverIcon      = null;
        this._popupTitleLabel     = null;
        this._popupArtistLabel    = null;
        this._popupDurationLabel  = null;
        this._popupProgressTrack  = null;
        this._popupProgressFill   = null;
        this._hidePopupTimeoutId  = null;
        this._progressTimeoutId   = null;
        this._lastArtUrl          = null;
        this._trackLengthUs       = 0;
        this._artCancellable      = null;
    }

    enable() {
        _debugMarker('enable');
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

        box.add_child(this._songLabel);
        this._indicator.add_child(box);

        // Hover → mostrar/ocultar panel con detalle de la canción.
        // Se engancha en el indicador y en sus hijos porque Clutter
        // dispara leave-event/enter-event al cruzar entre actores hijos.
        for (const actor of [this._indicator, this._songLabel]) {
            actor.connect('enter-event', () => this._onIndicatorEnter());
            actor.connect('leave-event', () => this._onIndicatorLeave());
        }

        this._buildHoverPopup();
        this._buildMenu();

        Main.panel.addToStatusArea('spotify-now-playing', this._indicator, 1, 'left');

        this._startWatching();
    }

    disable() {
        this._stopWatching();

        if (this._progressTimeoutId !== null) {
            GLib.source_remove(this._progressTimeoutId);
            this._progressTimeoutId = null;
        }
        if (this._hidePopupTimeoutId !== null) {
            GLib.source_remove(this._hidePopupTimeoutId);
            this._hidePopupTimeoutId = null;
        }
        this._artCancellable?.cancel();
        this._artCancellable = null;

        if (this._popup) {
            this._popup.destroy();
            this._popup = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._songLabel           = null;
        this._fontSizeItem        = null;
        this._popupCoverIcon      = null;
        this._popupTitleLabel     = null;
        this._popupArtistLabel    = null;
        this._popupDurationLabel  = null;
        this._popupProgressTrack  = null;
        this._popupProgressFill   = null;
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
        this._fontSizeItem?.label.set_text(this._fontSizeLabel());
    }

    _labelStyle() {
        return `padding: 0 6px 0 6px; font-size: ${this._fontSize}px;`;
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
        _debugMarker('onSpotifyAppeared');
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
        this._hideHoverPopup();
        this._lastArtUrl = null;
        this._trackLengthUs = 0;
        this._popupCoverIcon?.set_gicon(null);
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
        if (!this._proxy || !this._songLabel) return;
        _debugMarker('updateDisplay');

        try {
            const metadataVariant = this._proxy.get_cached_property('Metadata');

            if (!metadataVariant) {
                this._songLabel.set_text(IDLE_TEXT);
                this._lastArtUrl = null;
                this._trackLengthUs = 0;
                this._popupCoverIcon?.set_gicon(null);
                return;
            }

            const metadata  = metadataVariant.recursiveUnpack();
            const title     = metadata['xesam:title'] ?? '–';
            const artistRaw = metadata['xesam:artist'];
            const artist    = Array.isArray(artistRaw)
                ? artistRaw.join(', ')
                : (artistRaw ?? '–');

            let text = `♫  ${artist} – ${title}`;
            if (text.length > MAX_TEXT_LENGTH)
                text = text.slice(0, MAX_TEXT_LENGTH - 1) + '…';
            this._songLabel.set_text(text);

            // Datos para el popup de hover
            this._trackLengthUs = typeof metadata['mpris:length'] === 'number'
                ? metadata['mpris:length'] : 0;
            this._popupTitleLabel?.set_text(this._truncate(title, POPUP_TEXT_MAX_LEN));
            this._popupArtistLabel?.set_text(this._truncate(artist, POPUP_TEXT_MAX_LEN));
            this._updateProgress(0);

            const artUrl = metadata['mpris:artUrl'] ?? null;
            _debugMarker(`artUrl=${artUrl} lastArtUrl=${this._lastArtUrl}`);
            if (artUrl !== this._lastArtUrl) {
                this._lastArtUrl = artUrl;
                this._loadCoverArt(artUrl);
            }

        } catch (e) {
            console.error(`[spotify-now-playing] Display update error: ${e.message}`);
            this._songLabel?.set_text(IDLE_TEXT);
        }
    }

    // ─── Popup de hover ────────────────────────────────────────────────────────

    _buildHoverPopup() {
        this._popup = new St.BoxLayout({
            vertical: true,
            reactive: true,
            visible: false,
            style: `width: ${POPUP_WIDTH}px; padding: 10px; spacing: 8px; ` +
                   'background-color: rgba(24,24,24,0.97); border-radius: 8px; ' +
                   'border: 1px solid rgba(255,255,255,0.1);',
        });

        // Click en la carátula → alternar play/pausa
        this._popupCoverIcon = new St.Icon({
            icon_size: POPUP_ART_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: `width: ${POPUP_ART_SIZE}px; height: ${POPUP_ART_SIZE}px; border-radius: 6px;`,
        });
        this._popupCoverIcon.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                this._callMpris('PlayPause');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._popup.add_child(this._popupCoverIcon);

        const infoBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 4px;',
        });

        this._popupTitleLabel = new St.Label({
            text: '', x_align: Clutter.ActorAlign.CENTER,
            style: 'font-weight: bold; font-size: 13px;',
        });
        this._popupArtistLabel = new St.Label({
            text: '', x_align: Clutter.ActorAlign.CENTER,
            style: 'color: #bbb; font-size: 11px;',
        });

        infoBox.add_child(this._popupTitleLabel);
        infoBox.add_child(this._popupArtistLabel);
        this._popup.add_child(infoBox);

        this._popupProgressTrack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            style: `width: ${PROGRESS_BAR_WIDTH}px; height: 4px; border-radius: 2px; ` +
                   'background-color: rgba(255,255,255,0.2);',
        });
        this._popupProgressFill = new St.Widget({
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
            style: 'width: 0px; border-radius: 2px; background-color: #1DB954;',
        });
        this._popupProgressTrack.add_child(this._popupProgressFill);
        this._popup.add_child(this._popupProgressTrack);

        this._popupDurationLabel = new St.Label({
            text: '0:00 / 0:00', x_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 10px; color: #bbb;',
        });
        this._popup.add_child(this._popupDurationLabel);

        Main.layoutManager.uiGroup.add_child(this._popup);

        this._popup.connect('enter-event', () => this._cancelHidePopup());
        this._popup.connect('leave-event', () => this._scheduleHidePopup());
    }

    _onIndicatorEnter() {
        this._cancelHidePopup();
        if (!this._proxy) return;
        this._showHoverPopup();
    }

    _onIndicatorLeave() {
        this._scheduleHidePopup();
    }

    _showHoverPopup() {
        if (!this._popup || !this._proxy) return;
        this._positionPopup();
        this._popup.show();
        this._refreshPosition();
        if (this._progressTimeoutId === null) {
            this._progressTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROGRESS_UPDATE_MS, () => {
                this._refreshPosition();
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _hideHoverPopup() {
        this._popup?.hide();
        if (this._progressTimeoutId !== null) {
            GLib.source_remove(this._progressTimeoutId);
            this._progressTimeoutId = null;
        }
    }

    _scheduleHidePopup() {
        this._cancelHidePopup();
        this._hidePopupTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_HIDE_DELAY_MS, () => {
            this._hidePopupTimeoutId = null;
            this._hideHoverPopup();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelHidePopup() {
        if (this._hidePopupTimeoutId !== null) {
            GLib.source_remove(this._hidePopupTimeoutId);
            this._hidePopupTimeoutId = null;
        }
    }

    _positionPopup() {
        if (!this._popup || !this._indicator) return;

        const [x, y] = this._indicator.get_transformed_position();
        const height = this._indicator.get_height();
        let popupX = Math.round(x);

        const monitor = Main.layoutManager.findMonitorForActor(this._indicator)
            ?? Main.layoutManager.primaryMonitor;
        if (monitor) {
            const maxX = monitor.x + monitor.width - POPUP_WIDTH - 8;
            popupX = Math.min(popupX, maxX);
            popupX = Math.max(popupX, monitor.x + 8);
        }

        this._popup.set_position(popupX, Math.round(y + height));
    }

    // Consulta la posición de reproducción bajo demanda: MPRIS excluye
    // 'Position' de las señales PropertiesChanged por cambiar continuamente.
    _refreshPosition() {
        if (!this._proxy) return;
        this._proxy.get_connection().call(
            SPOTIFY_BUS_NAME,
            MPRIS_OBJECT_PATH,
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', [MPRIS_PLAYER_IFACE, 'Position']),
            GLib.VariantType.new('(v)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const reply = connection.call_finish(result);
                    const [positionUs] = reply.recursiveUnpack();
                    this._updateProgress(positionUs);
                } catch (e) {
                    console.error(`[spotify-now-playing] Position query failed: ${e.message}`);
                }
            }
        );
    }

    _updateProgress(positionUs) {
        if (!this._popupDurationLabel || !this._popupProgressFill) return;

        this._popupDurationLabel.set_text(
            `${this._formatTime(positionUs)} / ${this._formatTime(this._trackLengthUs)}`
        );

        const ratio = this._trackLengthUs > 0
            ? Math.min(1, Math.max(0, positionUs / this._trackLengthUs)) : 0;
        const fillWidth = Math.round(ratio * PROGRESS_BAR_WIDTH);
        this._popupProgressFill.set_style(
            `width: ${fillWidth}px; border-radius: 2px; background-color: #1DB954;`
        );
    }

    _formatTime(microseconds) {
        const totalSeconds = Math.max(0, Math.floor(microseconds / 1000000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    _truncate(text, maxLength) {
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    }

    _loadCoverArt(artUrl) {
        _debugMarker(`loadCoverArt artUrl=${artUrl}`);
        this._artCancellable?.cancel();
        this._popupCoverIcon?.set_gicon(null);

        if (!artUrl) return;

        const cancellable = new Gio.Cancellable();
        this._artCancellable = cancellable;

        Gio.File.new_for_uri(artUrl).load_contents_async(cancellable, (file, result) => {
            _debugMarker('loadCoverArt callback');
            try {
                const [, contents] = file.load_contents_finish(result);
                _debugMarker(`descarga OK bytes=${contents.length}`);
                this._saveCoverArt(contents, artUrl, cancellable);
            } catch (e) {
                if (!cancellable.is_cancelled())
                    console.error(`[spotify-now-playing] Cover art fetch failed: ${e.message}`);
                else
                    _debugMarker('descarga cancelada');
            }
        });
        _debugMarker('load_contents_async disparado');
    }

    // Cada artUrl se cachea en su propio archivo: St.TextureCache indexa las
    // texturas por ruta, así que sobrescribir siempre el mismo archivo hace
    // que el shell siga mostrando la imagen vieja al cambiar de canción.
    _artCachePathFor(artUrl) {
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, artUrl, -1);
        return GLib.build_filenamev([ART_CACHE_DIR, `cover-${hash}.jpg`]);
    }

    _saveCoverArt(contents, artUrl, cancellable) {
        try {
            GLib.mkdir_with_parents(ART_CACHE_DIR, 0o755);
            const cacheFile = Gio.File.new_for_path(this._artCachePathFor(artUrl));
            cacheFile.replace_contents_async(
                contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable,
                (file, result) => {
                    try {
                        file.replace_contents_finish(result);
                        if (!cancellable.is_cancelled())
                            this._popupCoverIcon?.set_gicon(Gio.FileIcon.new(cacheFile));
                    } catch (e) {
                        if (!cancellable.is_cancelled())
                            console.error(`[spotify-now-playing] Cover art save failed: ${e.message}`);
                    }
                }
            );
        } catch (e) {
            console.error(`[spotify-now-playing] Cover art save failed: ${e.message}`);
        }
    }
}
