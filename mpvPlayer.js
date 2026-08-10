/**
 * MpvPlayer — controla mpv como subproceso para reproducir streams de
 * radio (Rainwave / RadioTunes). GNOME Shell no tiene motor de audio propio,
 * así que delegamos la decodificación a un proceso externo en vez de
 * embeber GStreamer dentro del compositor.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const MPV_SOCKET_PATH = GLib.build_filenamev([
    GLib.get_user_runtime_dir() ?? GLib.get_tmp_dir(), 'powerzoid-music-mpv.sock'
]);

export class MpvPlayer {
    constructor() {
        this._subprocess      = null;
        this._exitCancellable = null;
        this.onStateChanged   = null; // (playing: boolean) => void
        this.onError          = null; // (message: string) => void
    }

    get isPlaying() {
        return this._subprocess !== null;
    }

    play(streamUrl) {
        this.stop();

        // Socket de una ejecución anterior podría quedar huérfano si mpv
        // murió sin limpiar; lo borramos para no conectar a un mpv fantasma.
        try {
            GLib.unlink(MPV_SOCKET_PATH);
        } catch (_e) { /* no existía */ }

        try {
            this._subprocess = Gio.Subprocess.new(
                [
                    'mpv', '--no-video', '--idle=no', '--really-quiet',
                    `--input-ipc-server=${MPV_SOCKET_PATH}`,
                    streamUrl,
                ],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) {
            this._subprocess = null;
            const notFound = e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
                || /no such file|not found/i.test(e.message ?? '');
            this.onError?.(
                notFound
                    ? 'mpv no está instalado. Ejecuta: sudo dnf install mpv'
                    : `No se pudo iniciar mpv: ${e.message}`
            );
            return;
        }

        this._exitCancellable = new Gio.Cancellable();
        const proc = this._subprocess;
        proc.wait_async(this._exitCancellable, (_proc, result) => {
            try {
                proc.wait_finish(result);
            } catch (_e) { /* cancelado por stop() */ }
            if (this._subprocess === proc) {
                this._subprocess = null;
                this.onStateChanged?.(false);
            }
        });

        this.onStateChanged?.(true);
    }

    stop() {
        if (!this._subprocess) return;
        this._exitCancellable?.cancel();
        this._exitCancellable = null;
        try {
            this._subprocess.force_exit();
        } catch (_e) { /* ya había terminado */ }
        this._subprocess = null;
    }

    destroy() {
        this.stop();
        this.onStateChanged = null;
        this.onError        = null;
    }

    // Pregunta a mpv el media-title actual (refleja el ICY StreamTitle del
    // stream si el servidor lo envía) vía su socket IPC JSON. Conexión
    // corta: se abre, se pregunta y se cierra en cada sondeo.
    queryMediaTitle(callback) {
        if (!this._subprocess) return;

        const client = new Gio.SocketClient();
        client.connect_async(
            Gio.UnixSocketAddress.new(MPV_SOCKET_PATH), null,
            (_source, result) => {
                let connection;
                try {
                    connection = client.connect_finish(result);
                } catch (_e) {
                    return; // socket aún no listo, o mpv ya no corre
                }

                const closeQuietly = () =>
                    connection.close_async(GLib.PRIORITY_DEFAULT, null, () => {});

                try {
                    const command = JSON.stringify({ command: ['get_property', 'media-title'] }) + '\n';
                    connection.get_output_stream().write_bytes(
                        new GLib.Bytes(new TextEncoder().encode(command)), null
                    );
                } catch (_e) {
                    closeQuietly();
                    return;
                }

                const input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() });
                input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
                    try {
                        const [line] = stream.read_line_finish_utf8(res);
                        if (line) {
                            const reply = JSON.parse(line);
                            if (reply.error === 'success' && typeof reply.data === 'string')
                                callback(reply.data);
                        }
                    } catch (_e) {
                        // respuesta malformada o socket cerrado; se ignora
                    } finally {
                        closeQuietly();
                    }
                });
            }
        );
    }
}
