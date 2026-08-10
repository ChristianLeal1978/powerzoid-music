/**
 * PowerZoid Music — GNOME Shell Extension
 *
 * Layout de la barra:  [ ♫/📻  Texto de la fuente activa ]
 *
 * Click izquierdo en texto   → Spotify: siguiente pista · Rainwave: siguiente
 *                               estación · RadioTunes: siguiente favorito
 * Click derecho en texto     → menú: Spotify / Rainwave / RadioTunes
 *                               (una queda marcada como activa), tamaño de letra
 * Hover sobre la extensión   → panel con carátula/ícono, título, artista
 *                               y progreso (Spotify) o estado en vivo (radio)
 * Click en la carátula       → alternar play/pausa (todas las fuentes)
 *
 * Fuentes soportadas:
 *  - Spotify: se observa vía MPRIS2/D-Bus (como antes), sin reproducir audio
 *    propio — Spotify ya lo hace.
 *  - Rainwave / RadioTunes: no hay un reproductor de escritorio con MPRIS,
 *    así que la extensión lanza `mpv` como subproceso y lo controla por su
 *    socket IPC (play/stop y lectura de metadata ICY). Requiere mpv
 *    instalado (`sudo dnf install mpv`).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { MpvPlayer } from './mpvPlayer.js';

const SPOTIFY_BUS_NAME    = 'org.mpris.MediaPlayer2.spotify';
const MPRIS_OBJECT_PATH   = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE  = 'org.mpris.MediaPlayer2.Player';

const SOURCE = { SPOTIFY: 'spotify', RAINWAVE: 'rainwave', RADIOTUNES: 'radiotunes' };

const RAINWAVE_STATIONS = [
    { id: 5, name: 'All',      url: 'https://rainwave.cc/tune_in/5.mp3.m3u' },
    { id: 1, name: 'Game',     url: 'https://rainwave.cc/tune_in/1.mp3.m3u' },
    { id: 4, name: 'Chiptune', url: 'https://rainwave.cc/tune_in/4.mp3.m3u' },
    { id: 2, name: 'OC ReMix', url: 'https://rainwave.cc/tune_in/2.mp3.m3u' },
    { id: 3, name: 'Covers',   url: 'https://rainwave.cc/tune_in/3.mp3.m3u' },
    { id: 6, name: 'Chill',    url: 'https://rainwave.cc/tune_in/6.mp3.m3u' },
];

// Catálogo de canales premium de RadioTunes (http://listen.radiotunes.com/premium_high.json).
// La extensión arma la URL final combinando el slug con el listen_key del usuario.
const RADIOTUNES_CHANNELS = [
    { name: '00s Country', slug: '00scountry' },
    { name: '00s Dance', slug: '00sdance' },
    { name: '00s Hits', slug: 'hit00s' },
    { name: '00s R&B', slug: '00srnb' },
    { name: '00s Rock', slug: '00srock' },
    { name: '60s Hits', slug: 'hit60s' },
    { name: '60s Rock', slug: '60srock' },
    { name: '70s Hits', slug: 'hit70s' },
    { name: '70s Rock', slug: '70srock' },
    { name: '80s Alt & New Wave', slug: '80saltnnewwave' },
    { name: '80s Dance', slug: '80sdance' },
    { name: '80s Hits', slug: 'the80s' },
    { name: '80s Rock Hits', slug: '80srock' },
    { name: '90s Country', slug: '90scountry' },
    { name: '90s Dance', slug: '90sdance' },
    { name: '90s Hits', slug: 'hit90s' },
    { name: '90s R&B', slug: '90srnb' },
    { name: '90s Rock', slug: '90srock' },
    { name: 'Alternative Rock', slug: 'altrock' },
    { name: 'Ambient', slug: 'ambient' },
    { name: 'American Songbook', slug: 'americansongbook' },
    { name: 'Baroque Period', slug: 'baroque' },
    { name: 'Bebop Jazz', slug: 'bebop' },
    { name: 'Blues Rock', slug: 'bluesrock' },
    { name: 'Bossa Nova', slug: 'bossanova' },
    { name: 'Café de Paris', slug: 'cafedeparis' },
    { name: 'Chill & Tropical House', slug: 'chillntropicalhouse' },
    { name: 'Chillout', slug: 'chillout' },
    { name: 'Classic Hip-Hop', slug: 'classicrap' },
    { name: 'Classic Motown', slug: 'classicmotown' },
    { name: 'Classic Rock', slug: 'classicrock' },
    { name: 'Classical Guitar', slug: 'guitar' },
    { name: 'Classical Period', slug: 'classicalperiod' },
    { name: 'Classical Piano Trios', slug: 'classicalpianotrios' },
    { name: 'Club Bollywood', slug: 'clubbollywood' },
    { name: 'Coffee Jazz', slug: 'coffeejazz' },
    { name: 'Contemporary Christian', slug: 'christian' },
    { name: 'Country', slug: 'country' },
    { name: 'Cuban Lounge', slug: 'cubanlounge' },
    { name: 'Dance Hits', slug: 'dancehits' },
    { name: 'DaTempo Lounge', slug: 'datempolounge' },
    { name: 'Dave Koz & Friends', slug: 'davekoz' },
    { name: 'Disco Party', slug: 'discoparty' },
    { name: 'Downtempo Lounge', slug: 'downtempolounge' },
    { name: 'Dreamscapes', slug: 'dreamscapes' },
    { name: 'Easy Listening', slug: 'easylistening' },
    { name: 'EDM Fest', slug: 'edmfest' },
    { name: 'Epic Music', slug: 'epicmusic' },
    { name: 'EuroDance', slug: 'eurodance' },
    { name: 'Hard Rock', slug: 'hardrock' },
    { name: 'Indie Dance', slug: 'indiedance' },
    { name: 'Indie Rock', slug: 'indierock' },
    { name: 'Jazz Classics', slug: 'jazzclassics' },
    { name: 'J-pop', slug: 'jpop' },
    { name: 'K-pop', slug: 'kpop' },
    { name: 'Latin Pop Hits', slug: 'latinpophits' },
    { name: 'Lounge', slug: 'lounge' },
    { name: 'Love Music', slug: 'lovemusic' },
    { name: 'Meditation', slug: 'meditation' },
    { name: 'Mellow Jazz', slug: 'mellowjazz' },
    { name: 'Mellow Smooth Jazz', slug: 'mellowsmoothjazz' },
    { name: 'Metal', slug: 'metal' },
    { name: 'Modern Blues', slug: 'modernblues' },
    { name: 'Modern Rock', slug: 'modernrock' },
    { name: 'Mostly Classical', slug: 'classical' },
    { name: 'Movie Soundtracks', slug: 'soundtracks' },
    { name: 'Mozart', slug: 'mozart' },
    { name: 'Nature', slug: 'nature' },
    { name: 'New Age', slug: 'newage' },
    { name: 'Old School Funk & Soul', slug: 'oldschoolfunknsoul' },
    { name: 'Oldies', slug: 'oldies' },
    { name: 'Piano Jazz', slug: 'pianojazz' },
    { name: 'Pop Rock', slug: 'poprock' },
    { name: 'Reggaeton', slug: 'reggaeton' },
    { name: 'Relaxation', slug: 'relaxation' },
    { name: 'Relaxing Ambient Piano', slug: 'relaxingambientpiano' },
    { name: 'Romantic Period', slug: 'romantic' },
    { name: 'Romantica', slug: 'romantica' },
    { name: 'Romántica Latina', slug: 'romanticalatina' },
    { name: 'Roots Reggae', slug: 'rootsreggae' },
    { name: 'Salsa', slug: 'salsa' },
    { name: 'Sleep Relaxation', slug: 'sleeprelaxation' },
    { name: 'Slow R&B', slug: 'slowjams' },
    { name: 'Smooth Beats', slug: 'smoothbeats' },
    { name: 'Smooth Bossa Nova', slug: 'smoothbossanova' },
    { name: 'Smooth Jazz', slug: 'smoothjazz' },
    { name: "Smooth Jazz 24'7", slug: 'smoothjazz247' },
    { name: 'Smooth Lounge', slug: 'smoothlounge' },
    { name: 'Soft Rock', slug: 'softrock' },
    { name: 'Solo Piano', slug: 'solopiano' },
    { name: 'Top Hits', slug: 'tophits' },
    { name: 'Uptempo Smooth Jazz', slug: 'uptemposmoothjazz' },
    { name: 'Urban Hits', slug: 'urbanjamz' },
    { name: 'Urban Pop Hits', slug: 'urbanpophits' },
    { name: 'Vocal Chillout', slug: 'vocalchillout' },
    { name: 'Vocal Lounge', slug: 'vocallounge' },
    { name: 'Vocal New Age', slug: 'vocalnewage' },
    { name: 'Vocal Smooth Jazz', slug: 'vocalsmoothjazz' },
    { name: 'World', slug: 'world' },
];

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
const RADIO_POLL_MS        = 5000;
const HOVER_HIDE_DELAY_MS  = 150;

const ART_CACHE_DIR = GLib.build_filenamev([
    GLib.get_user_cache_dir(), 'spotify-now-playing-gnome'
]);

export default class PowerZoidMusicExtension {
    constructor(metadata) {
        this._metadata            = metadata;
        this._indicator           = null;
        this._songLabel           = null;
        this._proxy               = null;
        this._watcherId           = null;
        this._propertiesChangedId = null;
        this._fontSize            = DEFAULT_FONT_SIZE;
        this._fontSizeItem        = null;

        // Fuente activa
        this._source               = SOURCE.SPOTIFY;
        this._rainwaveStationId    = RAINWAVE_STATIONS[0].id;
        this._radiotunesListenKey  = '';
        this._radiotunesActiveSlug = null;
        this._radiotunesFavorites  = [];
        this._mpvPlayer            = null;
        this._radioPollTimeoutId   = null;
        this._radioMediaTitle      = null;

        // Ítems del menú de selección de fuente
        this._spotifyMenuItem              = null;
        this._rainwaveSubMenuItem          = null;
        this._rainwaveStationItems         = new Map();
        this._radiotunesSubMenuItem        = null;
        this._radiotunesEntryItem          = null;
        this._radiotunesEntry              = null;
        this._radiotunesChangeKeyItem      = null;
        this._radiotunesFavoriteToggleItem = null;
        this._radiotunesFavoritesSection   = null;
        this._radiotunesAllItems           = new Map();
        this._radiotunesFavoriteItems      = new Map();

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
        this._loadSettings();

        // false → PanelMenu crea el menú popup automáticamente
        this._indicator = new PanelMenu.Button(0.0, 'PowerZoid Music', false);

        const box = new St.BoxLayout({ style: 'spacing: 2px;' });

        // Zona izquierda: nombre de la canción / emisora
        // Click izquierdo → avanzar (pista/estación/favorito según fuente)
        // Click derecho   → menú
        this._songLabel = new St.Label({
            text: IDLE_TEXT,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: this._labelStyle(),
        });
        this._songLabel.connect('button-press-event', (_actor, event) => {
            const button = event.get_button();
            if (button === 1) {
                if (this._source === SOURCE.SPOTIFY)
                    this._callMpris('Next');
                else if (this._source === SOURCE.RAINWAVE)
                    this._cycleRainwaveStation();
                else
                    this._cycleRadiotunesFavorite();
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

        this._mpvPlayer = new MpvPlayer();
        this._mpvPlayer.onStateChanged = (playing) => this._onRadioStateChanged(playing);
        this._mpvPlayer.onError = (message) => this._onRadioError(message);

        this._buildHoverPopup();
        this._buildMenu();

        Main.panel.addToStatusArea('powerzoid-music', this._indicator, 1, 'left');

        this._applyInitialSource();
    }

    disable() {
        this._stopWatching();

        this._mpvPlayer?.destroy();
        this._mpvPlayer = null;
        this._stopRadioPoll();

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
        this._songLabel                      = null;
        this._fontSizeItem                   = null;
        this._popupCoverIcon                 = null;
        this._popupTitleLabel                = null;
        this._popupArtistLabel               = null;
        this._popupDurationLabel             = null;
        this._popupProgressTrack             = null;
        this._popupProgressFill              = null;
        this._spotifyMenuItem                = null;
        this._rainwaveSubMenuItem            = null;
        this._rainwaveStationItems.clear();
        this._radiotunesSubMenuItem          = null;
        this._radiotunesEntryItem            = null;
        this._radiotunesEntry                = null;
        this._radiotunesChangeKeyItem        = null;
        this._radiotunesFavoriteToggleItem   = null;
        this._radiotunesFavoritesSection     = null;
        this._radiotunesAllItems.clear();
        this._radiotunesFavoriteItems.clear();
    }

    // ─── Selección de fuente ───────────────────────────────────────────────────

    _applyInitialSource() {
        this._refreshSourceOrnaments();
        if (this._source === SOURCE.SPOTIFY)
            this._startWatching();
        else
            this._songLabel.set_text(this._radioIdleLabel());
    }

    // Libera lo que la fuente actual estuviera usando antes de pasar a otra:
    // Spotify es una app externa que sigue sonando aunque dejemos de
    // observarla por D-Bus, así que hay que pausarla explícitamente para
    // que no se solape con la radio. Rainwave/RadioTunes comparten el mismo
    // mpv, que siempre se detiene antes de arrancar un stream nuevo.
    _leaveCurrentSource() {
        if (this._source === SOURCE.SPOTIFY) {
            this._pauseSpotify();
            this._stopWatching();
        } else {
            this._stopRadioPlayback();
        }
    }

    // Llamada directa al bus de Spotify por su nombre conocido, sin depender
    // de this._proxy: si el proxy aún no está listo (o quedó obsoleto tras
    // un blip de D-Bus), _callMpris('Pause') no hace nada y no deja rastro.
    _pauseSpotify() {
        Gio.DBus.session.call(
            SPOTIFY_BUS_NAME,
            MPRIS_OBJECT_PATH,
            MPRIS_PLAYER_IFACE,
            'Pause',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try { connection.call_finish(result); }
                catch (e) { console.error(`[powerzoid-music] Pause Spotify failed: ${e.message}`); }
            }
        );
    }

    _switchToSpotify() {
        if (this._source === SOURCE.SPOTIFY) return;
        this._leaveCurrentSource();
        this._source = SOURCE.SPOTIFY;
        this._saveSettings();
        this._refreshSourceOrnaments();
        this._songLabel.set_text(IDLE_TEXT);
        this._startWatching();
    }

    _selectRainwaveStation(id) {
        const station = RAINWAVE_STATIONS.find(s => s.id === id);
        if (!station) return;
        this._leaveCurrentSource();
        this._rainwaveStationId = id;
        this._source = SOURCE.RAINWAVE;
        this._saveSettings();
        this._refreshSourceOrnaments();
        this._startRadioPlayback(station.url);
    }

    _cycleRainwaveStation() {
        const idx = RAINWAVE_STATIONS.findIndex(s => s.id === this._rainwaveStationId);
        const next = RAINWAVE_STATIONS[(idx + 1) % RAINWAVE_STATIONS.length];
        this._selectRainwaveStation(next.id);
    }

    _selectRadiotunesChannel(slug) {
        const key = this._radiotunesEntry?.get_text().trim() ?? this._radiotunesListenKey;
        if (!key) {
            this._songLabel?.set_text('⚠ Falta listen_key');
            return;
        }
        this._radiotunesListenKey = key;
        this._refreshRadiotunesKeyRow();
        this._leaveCurrentSource();
        this._radiotunesActiveSlug = slug;
        this._source = SOURCE.RADIOTUNES;
        this._saveSettings();
        this._refreshSourceOrnaments();
        this._startRadioPlayback(this._radiotunesStreamUrl(slug));
    }

    _cycleRadiotunesFavorite() {
        if (this._radiotunesFavorites.length === 0) return;
        const idx = this._radiotunesFavorites.indexOf(this._radiotunesActiveSlug);
        const next = this._radiotunesFavorites[(idx + 1) % this._radiotunesFavorites.length];
        this._selectRadiotunesChannel(next);
    }

    _toggleRadiotunesFavorite() {
        if (!this._radiotunesActiveSlug) return;
        const slug = this._radiotunesActiveSlug;
        const idx = this._radiotunesFavorites.indexOf(slug);
        if (idx === -1)
            this._radiotunesFavorites.push(slug);
        else
            this._radiotunesFavorites.splice(idx, 1);
        this._saveSettings();
        this._rebuildRadiotunesFavoritesMenu();
        this._refreshSourceOrnaments();
    }

    _radiotunesStreamUrl(slug) {
        return `http://listen.radiotunes.com/premium_high/${slug}.pls`
            + `?listen_key=${encodeURIComponent(this._radiotunesListenKey)}`;
    }

    _sourceLabel() {
        if (this._source === SOURCE.RAINWAVE) return 'Rainwave';
        if (this._source === SOURCE.RADIOTUNES) return 'RadioTunes';
        return 'Spotify';
    }

    _refreshSourceOrnaments() {
        this._spotifyMenuItem?.setOrnament(
            this._source === SOURCE.SPOTIFY ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );

        this._rainwaveSubMenuItem?.setOrnament(
            this._source === SOURCE.RAINWAVE ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        for (const [id, item] of this._rainwaveStationItems) {
            item.setOrnament(
                this._source === SOURCE.RAINWAVE && id === this._rainwaveStationId
                    ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
            );
        }

        this._radiotunesSubMenuItem?.setOrnament(
            this._source === SOURCE.RADIOTUNES ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        const activeSlug = this._source === SOURCE.RADIOTUNES ? this._radiotunesActiveSlug : null;
        for (const [slug, item] of this._radiotunesAllItems) {
            item.setOrnament(slug === activeSlug ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
        for (const [slug, item] of this._radiotunesFavoriteItems) {
            item.setOrnament(slug === activeSlug ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
        this._refreshRadiotunesFavoriteToggleLabel();
    }

    _refreshRadiotunesFavoriteToggleLabel() {
        if (!this._radiotunesFavoriteToggleItem) return;
        const slug = this._radiotunesActiveSlug;
        const isFav = !!slug && this._radiotunesFavorites.includes(slug);
        this._radiotunesFavoriteToggleItem.label.set_text(
            isFav ? '★  Quitar de favoritos' : '☆  Añadir a favoritos'
        );
    }

    // ─── Reproducción de radio (Rainwave / RadioTunes vía mpv) ────────────────

    _startRadioPlayback(url) {
        this._radioMediaTitle = null;
        this._songLabel.set_text(this._radioIdleLabel());
        this._setPopupGenericIcon();
        this._mpvPlayer.play(url);
    }

    _stopRadioPlayback() {
        this._mpvPlayer?.stop();
        this._stopRadioPoll();
        this._radioMediaTitle = null;
    }

    _toggleRadioPlayback() {
        if (this._source === SOURCE.SPOTIFY) return;
        if (this._mpvPlayer?.isPlaying) {
            this._stopRadioPlayback();
            this._songLabel.set_text(this._radioIdleLabel());
            this._updateRadioPopupContent();
            return;
        }
        let url = null;
        if (this._source === SOURCE.RAINWAVE) {
            const station = RAINWAVE_STATIONS.find(s => s.id === this._rainwaveStationId);
            url = station?.url ?? null;
        } else if (this._source === SOURCE.RADIOTUNES && this._radiotunesActiveSlug) {
            url = this._radiotunesStreamUrl(this._radiotunesActiveSlug);
        }
        if (!url) return;
        this._startRadioPlayback(url);
    }

    _onRadioStateChanged(playing) {
        if (playing) {
            this._startRadioPoll();
            return;
        }
        this._stopRadioPoll();
        this._radioMediaTitle = null;
        if (this._source !== SOURCE.SPOTIFY) {
            this._songLabel?.set_text(this._radioIdleLabel());
            this._updateRadioPopupContent();
        }
    }

    _onRadioError(message) {
        console.error(`[powerzoid-music] ${message}`);
        this._songLabel?.set_text('⚠ mpv');
    }

    _startRadioPoll() {
        if (this._radioPollTimeoutId !== null) return;
        const poll = () => {
            this._mpvPlayer?.queryMediaTitle((title) => {
                this._radioMediaTitle = title;
                this._applyRadioMediaTitle(title);
            });
            return GLib.SOURCE_CONTINUE;
        };
        // mpv tarda un instante en crear su socket IPC tras arrancar:
        // preguntar en t=0 casi siempre falla en silencio y deja el rótulo
        // mostrando el canal hasta el siguiente sondeo completo. Se espera
        // 1s antes del primer intento y luego se sigue en el intervalo normal.
        this._radioPollTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            poll();
            this._radioPollTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RADIO_POLL_MS, poll);
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopRadioPoll() {
        if (this._radioPollTimeoutId !== null) {
            GLib.source_remove(this._radioPollTimeoutId);
            this._radioPollTimeoutId = null;
        }
    }

    _applyRadioMediaTitle(title) {
        if (this._source === SOURCE.SPOTIFY) return;
        let text = `📻  ${title}`;
        if (text.length > MAX_TEXT_LENGTH)
            text = text.slice(0, MAX_TEXT_LENGTH - 1) + '…';
        this._songLabel?.set_text(text);
        this._updateRadioPopupContent();
    }

    _radioIdleLabel() {
        if (this._source === SOURCE.RAINWAVE) {
            const station = RAINWAVE_STATIONS.find(s => s.id === this._rainwaveStationId);
            return `📻  Rainwave: ${station?.name ?? '?'}`;
        }
        if (this._source === SOURCE.RADIOTUNES) {
            const channel = RADIOTUNES_CHANNELS.find(c => c.slug === this._radiotunesActiveSlug);
            return channel ? `📻  RadioTunes: ${channel.name}` : '📻  RadioTunes';
        }
        return IDLE_TEXT;
    }

    // ─── Menú contextual ───────────────────────────────────────────────────────

    _buildMenu() {
        this._spotifyMenuItem = new PopupMenu.PopupMenuItem('Spotify');
        this._spotifyMenuItem.connect('activate', () => this._switchToSpotify());
        this._indicator.menu.addMenuItem(this._spotifyMenuItem);

        this._rainwaveSubMenuItem = new PopupMenu.PopupSubMenuMenuItem('Rainwave');
        this._indicator.menu.addMenuItem(this._rainwaveSubMenuItem);
        for (const station of RAINWAVE_STATIONS) {
            const item = new PopupMenu.PopupMenuItem(station.name);
            item.connect('activate', () => this._selectRainwaveStation(station.id));
            this._rainwaveSubMenuItem.menu.addMenuItem(item);
            this._rainwaveStationItems.set(station.id, item);
        }

        this._radiotunesSubMenuItem = new PopupMenu.PopupSubMenuMenuItem('RadioTunes');
        this._indicator.menu.addMenuItem(this._radiotunesSubMenuItem);
        this._buildRadiotunesSubMenu();

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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

    // RadioTunes no tiene una lista fija de canales pública: el usuario pega
    // solo su listen_key (obtenido de su cuenta premium) y la extensión arma
    // la URL de cada canal a partir del catálogo conocido.
    //
    // Favoritos y Todos los canales van como secciones planas dentro de este
    // mismo submenú (no como sub-submenús): GNOME Shell cierra el menú entero
    // al anidar un PopupSubMenuMenuItem dentro de otro, así que un tercer
    // nivel de anidación no es viable.
    _buildRadiotunesSubMenu() {
        this._radiotunesEntryItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        this._radiotunesEntry = new St.Entry({
            hint_text: 'Tu listen_key de RadioTunes',
            text: this._radiotunesListenKey,
            can_focus: true,
            x_expand: true,
            style: 'width: 260px;',
        });
        this._radiotunesEntry.clutter_text.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._radiotunesListenKey = this._radiotunesEntry.get_text().trim();
                this._saveSettings();
                this._refreshRadiotunesKeyRow();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._radiotunesEntryItem.add_child(this._radiotunesEntry);
        this._radiotunesSubMenuItem.menu.addMenuItem(this._radiotunesEntryItem);

        this._radiotunesChangeKeyItem = new PopupMenu.PopupMenuItem('🔑  Cambiar listen_key');
        this._radiotunesChangeKeyItem.connect('activate', () => {
            this._radiotunesEntryItem.visible = true;
            this._radiotunesChangeKeyItem.visible = false;
        });
        this._radiotunesSubMenuItem.menu.addMenuItem(this._radiotunesChangeKeyItem);

        this._radiotunesFavoriteToggleItem = new PopupMenu.PopupMenuItem('☆  Añadir a favoritos');
        this._radiotunesFavoriteToggleItem.connect('activate', () => this._toggleRadiotunesFavorite());
        this._radiotunesSubMenuItem.menu.addMenuItem(this._radiotunesFavoriteToggleItem);

        this._radiotunesSubMenuItem.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Favoritos'));

        this._radiotunesFavoritesSection = new PopupMenu.PopupMenuSection();
        this._radiotunesSubMenuItem.menu.addMenuItem(this._radiotunesFavoritesSection);
        this._rebuildRadiotunesFavoritesMenu();

        this._radiotunesSubMenuItem.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Todos los canales'));

        for (const channel of RADIOTUNES_CHANNELS) {
            const item = new PopupMenu.PopupMenuItem(channel.name);
            item.connect('activate', () => this._selectRadiotunesChannel(channel.slug));
            this._radiotunesSubMenuItem.menu.addMenuItem(item);
            this._radiotunesAllItems.set(channel.slug, item);
        }

        this._refreshRadiotunesKeyRow();
    }

    _refreshRadiotunesKeyRow() {
        const hasKey = !!this._radiotunesListenKey;
        if (this._radiotunesEntryItem) this._radiotunesEntryItem.visible = !hasKey;
        if (this._radiotunesChangeKeyItem) this._radiotunesChangeKeyItem.visible = hasKey;
    }

    _rebuildRadiotunesFavoritesMenu() {
        this._radiotunesFavoritesSection.removeAll();
        this._radiotunesFavoriteItems.clear();

        if (this._radiotunesFavorites.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('Sin favoritos aún', { reactive: false });
            empty.label.set_style('color: #aaa; font-style: italic;');
            this._radiotunesFavoritesSection.addMenuItem(empty);
            return;
        }

        for (const slug of this._radiotunesFavorites) {
            const channel = RADIOTUNES_CHANNELS.find(c => c.slug === slug);
            const item = new PopupMenu.PopupMenuItem(channel?.name ?? slug);
            item.connect('activate', () => this._selectRadiotunesChannel(slug));
            this._radiotunesFavoritesSection.addMenuItem(item);
            this._radiotunesFavoriteItems.set(slug, item);
        }
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
                this._source = Object.values(SOURCE).includes(data.source) ? data.source : SOURCE.SPOTIFY;
                this._rainwaveStationId = RAINWAVE_STATIONS.some(s => s.id === data.rainwaveStationId)
                    ? data.rainwaveStationId : RAINWAVE_STATIONS[0].id;
                this._radiotunesListenKey = typeof data.radiotunesListenKey === 'string'
                    ? data.radiotunesListenKey : '';
                this._radiotunesActiveSlug = typeof data.radiotunesActiveSlug === 'string'
                    ? data.radiotunesActiveSlug : null;
                this._radiotunesFavorites = Array.isArray(data.radiotunesFavorites)
                    ? data.radiotunesFavorites.filter(s => typeof s === 'string') : [];
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
            const data = new TextEncoder().encode(JSON.stringify({
                fontSize: this._fontSize,
                source: this._source,
                rainwaveStationId: this._rainwaveStationId,
                radiotunesListenKey: this._radiotunesListenKey,
                radiotunesActiveSlug: this._radiotunesActiveSlug,
                radiotunesFavorites: this._radiotunesFavorites,
            }));
            file.replace_contents(
                data, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            console.error(`[powerzoid-music] Settings save failed: ${e.message}`);
        }
    }

    // ─── D-Bus / MPRIS (Spotify) ───────────────────────────────────────────────

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
                    const proxy = Gio.DBusProxy.new_finish(result);
                    // El usuario pudo cambiar de fuente mientras se conectaba
                    if (this._source !== SOURCE.SPOTIFY) return;
                    this._proxy = proxy;
                    this._propertiesChangedId = this._proxy.connect(
                        'g-properties-changed',
                        this._onPropertiesChanged.bind(this)
                    );
                    this._updateDisplay();
                } catch (e) {
                    console.error(`[powerzoid-music] Proxy init failed: ${e.message}`);
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
                catch (e) { console.error(`[powerzoid-music] ${method} failed: ${e.message}`); }
            }
        );
    }

    _onPropertiesChanged(_proxy, changed, _invalidated) {
        try {
            const props = changed.recursiveUnpack();
            if ('Metadata' in props || 'PlaybackStatus' in props)
                this._updateDisplay();
        } catch (e) {
            console.error(`[powerzoid-music] PropertiesChanged error: ${e.message}`);
        }
    }

    _updateDisplay() {
        if (!this._proxy || !this._songLabel) return;

        try {
            this._popupProgressTrack?.show();

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
            if (artUrl !== this._lastArtUrl) {
                this._lastArtUrl = artUrl;
                this._loadCoverArt(artUrl);
            }

        } catch (e) {
            console.error(`[powerzoid-music] Display update error: ${e.message}`);
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

        // Click en la carátula/ícono → alternar reproducción
        this._popupCoverIcon = new St.Icon({
            icon_size: POPUP_ART_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            style: `width: ${POPUP_ART_SIZE}px; height: ${POPUP_ART_SIZE}px; border-radius: 6px;`,
        });
        this._popupCoverIcon.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                if (this._source === SOURCE.SPOTIFY)
                    this._callMpris('PlayPause');
                else
                    this._toggleRadioPlayback();
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
        if (this._source === SOURCE.SPOTIFY && !this._proxy) return;
        this._showHoverPopup();
    }

    _onIndicatorLeave() {
        this._scheduleHidePopup();
    }

    _showHoverPopup() {
        if (!this._popup) return;
        if (this._source === SOURCE.SPOTIFY && !this._proxy) return;

        this._positionPopup();
        this._popup.show();

        if (this._source === SOURCE.SPOTIFY) {
            this._refreshPosition();
            if (this._progressTimeoutId === null) {
                this._progressTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROGRESS_UPDATE_MS, () => {
                    this._refreshPosition();
                    return GLib.SOURCE_CONTINUE;
                });
            }
        } else {
            this._updateRadioPopupContent();
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
                    console.error(`[powerzoid-music] Position query failed: ${e.message}`);
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

    // Contenido del popup de hover cuando la fuente activa es una radio
    // (Rainwave/RadioTunes): sin carátula ni progreso, solo título/artista
    // (metadata ICY leída de mpv) y estado en vivo.
    _updateRadioPopupContent() {
        if (!this._popup) return;
        const playing = this._mpvPlayer?.isPlaying ?? false;

        this._setPopupGenericIcon();
        this._popupTitleLabel?.set_text(
            this._truncate(this._radioMediaTitle ?? (playing ? 'Sintonizando…' : 'Detenido'), POPUP_TEXT_MAX_LEN)
        );
        this._popupArtistLabel?.set_text(this._sourceLabel());
        this._popupProgressTrack?.hide();
        this._popupDurationLabel?.set_text(playing ? '🔴 En vivo' : '⏹ Detenido');
    }

    _setPopupGenericIcon() {
        this._popupCoverIcon?.set_gicon(Gio.ThemedIcon.new('audio-x-generic-symbolic'));
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
        this._artCancellable?.cancel();
        this._popupCoverIcon?.set_gicon(null);

        if (!artUrl) return;

        const cancellable = new Gio.Cancellable();
        this._artCancellable = cancellable;

        Gio.File.new_for_uri(artUrl).load_contents_async(cancellable, (file, result) => {
            try {
                const [, contents] = file.load_contents_finish(result);
                this._saveCoverArt(contents, artUrl, cancellable);
            } catch (e) {
                if (!cancellable.is_cancelled())
                    console.error(`[powerzoid-music] Cover art fetch failed: ${e.message}`);
            }
        });
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
                            console.error(`[powerzoid-music] Cover art save failed: ${e.message}`);
                    }
                }
            );
        } catch (e) {
            console.error(`[powerzoid-music] Cover art save failed: ${e.message}`);
        }
    }
}
