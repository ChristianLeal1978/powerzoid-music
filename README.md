# PowerZoid Music — GNOME Shell Extension

Extensión para GNOME Shell que muestra en la barra superior lo que se está reproduciendo, con controles integrados. Soporta tres fuentes, elegibles con click derecho:

- **Spotify** — observado vía MPRIS2/D-Bus, igual que siempre.
- **Rainwave** — streaming directo de la radio comunitaria de música de videojuegos.
- **RadioTunes** — streaming directo con tu cuenta premium (mediante tu URL de stream con `listen_key`).

```
♫  GameChops – Aryll's Theme
📻  Rainwave: Game
```

## Características

- **Selector de fuente** por click derecho: Spotify, Rainwave (5 canales) o RadioTunes (tu URL de stream)
- **Artista y título** de la canción actual en tiempo real (Spotify vía MPRIS; Rainwave/RadioTunes vía metadata ICY del stream)
- **Click en el texto** → siguiente pista (Spotify) o play/stop (radio)
- **Click en la carátula/ícono** → alterna reproducción
- **Actualización instantánea** vía señales D-Bus en Spotify (sin polling); sondeo liviano cada 5 s en modo radio
- Aparece solo cuando hay algo que mostrar; en Spotify desaparece automáticamente al cerrarlo

## Cómo funciona

### Spotify

Spotify en Linux implementa el estándar **MPRIS2** (`org.mpris.MediaPlayer2`) sobre el bus de sesión D-Bus. La extensión:

1. Vigila el bus esperando que aparezca `org.mpris.MediaPlayer2.spotify`
2. Al detectarlo, crea un proxy D-Bus a la interfaz `org.mpris.MediaPlayer2.Player`
3. Se suscribe a la señal `PropertiesChanged` para recibir cambios en tiempo real
4. Lee `xesam:title`, `xesam:artist` y `PlaybackStatus` del campo `Metadata`
5. Llama a `Next` o `PlayPause` según el control pulsado

No se necesita ningún servidor local, userscript ni servicio systemd.

### Rainwave y RadioTunes

GNOME Shell no tiene un motor de audio propio, así que para estas dos fuentes la extensión lanza **[mpv](https://mpv.io/)** como subproceso y lo controla mediante su socket IPC (play/stop y lectura de la metadata ICY del stream para mostrar artista/título). Es necesario tener mpv instalado:

```bash
sudo dnf install mpv
```

- **Rainwave** usa las URLs públicas de sintonización de rainwave.cc (`https://rainwave.cc/tune_in/<id>.mp3`), sin necesidad de cuenta ni API key.
- **RadioTunes** no tiene una API pública documentada. Su cuenta premium sí ofrece, de forma oficial, una URL de stream con un parámetro `listen_key` pensada para reproductores externos (VLC, Winamp, Sonos, etc.) — es lo mismo que usa la extensión, sin necesidad de guardar tu usuario/contraseña. Para obtenerla:
  1. Entra a tu cuenta en [radiotunes.com](https://www.radiotunes.com) con tu suscripción premium activa.
  2. Busca la opción para reproducir en un reproductor externo / dispositivo (Winamp, VLC, Sonos, Squeezebox…) — suele estar en la configuración de la cuenta o en el propio reproductor de la web.
  3. Copia la URL de stream que te entrega (incluye tu `listen_key`).
  4. Pégala en el menú de la extensión: click derecho → **Fuente** → **RadioTunes** → pega la URL → **▶ Reproducir**.

  Si RadioTunes cambia este mecanismo en el futuro, solo hace falta repetir estos pasos y pegar la URL nueva — la extensión no depende de un formato fijo, reproduce cualquier URL de stream que le des.

## Requisitos

- Fedora 44 (o cualquier distro con GNOME Shell 45–50)
- Spotify instalado (versión de escritorio para Linux) — solo si usas esa fuente
- `mpv` instalado — solo si usas Rainwave o RadioTunes

## Instalación

```bash
# Descomprimir en el directorio de extensiones
unzip spotify-now-playing-gnome.zip \
  -d ~/.local/share/gnome-shell/extensions/

# Cerrar sesión y volver a entrar (necesario en Wayland)
gnome-session-quit --logout
```

Al iniciar sesión de nuevo:

```bash
gnome-extensions enable spotify-now-playing@cleal.cl
```

### Instalación desde el repositorio

```bash
git clone https://github.com/ChristianLeal1978/spotify-now-playing-gnome.git
cd spotify-now-playing-gnome

# Copiar la extensión
cp -r spotify-now-playing@cleal.cl \
  ~/.local/share/gnome-shell/extensions/

# Cerrar sesión y volver a entrar, luego:
gnome-extensions enable spotify-now-playing@cleal.cl
```

## Actualizar una instalación existente

```bash
# Sobreescribir solo los archivos cambiados
cp -r spotify-now-playing@cleal.cl \
  ~/.local/share/gnome-shell/extensions/

# Cerrar sesión y volver a entrar
gnome-session-quit --logout
```

> El identificador interno (`spotify-now-playing@cleal.cl`) no cambió al renombrar la extensión a "PowerZoid Music" — es solo el nombre visible en el panel y en Extensiones. Una actualización no requiere desinstalar ni volver a habilitarla manualmente (más allá de cerrar sesión para recargar el código).

## Desinstalar

```bash
gnome-extensions disable spotify-now-playing@cleal.cl
rm -rf ~/.local/share/gnome-shell/extensions/spotify-now-playing@cleal.cl
```

## Uso

| Acción | Resultado |
|--------|-----------|
| Click derecho | Abre el menú: elegir fuente (Spotify/Rainwave/RadioTunes), tamaño de letra |
| Click en el texto de la barra | Spotify: siguiente pista · Rainwave/RadioTunes: play/stop |
| Click en la carátula/ícono del popup | Alterna reproducción (PlayPause en Spotify, play/stop en radio) |

El texto se trunca automáticamente a 50 caracteres si es muy largo.

## Compatibilidad

| GNOME Shell | Fedora  | Estado |
|-------------|---------|--------|
| 50          | 44      | ✅ Probado |
| 48          | 42–43   | ✅ Compatible |
| 45–47       | 39–41   | ✅ Compatible |

## Estructura del proyecto

```
spotify-now-playing@cleal.cl/
├── metadata.json   # UUID, nombre, versiones de GNOME Shell compatibles
├── extension.js    # Lógica completa: proxy D-Bus, UI, selector de fuente, controles
└── mpvPlayer.js     # Subproceso mpv + control IPC para Rainwave/RadioTunes
```

## Licencia

GPL-2.0 — ver [LICENSE](LICENSE)
