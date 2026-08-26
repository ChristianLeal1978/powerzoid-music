# PowerZoid Music — GNOME Shell Extension

Extensión para GNOME Shell que muestra en la barra superior lo que se está reproduciendo, con controles integrados. Las cuatro fuentes aparecen siempre a la vez en el menú (click derecho) y una queda marcada como activa:

- **Spotify** — observado vía MPRIS2/D-Bus, igual que siempre.
- **Purrr** — reproductor propio de música cacheada desde Google Drive, también observado vía MPRIS2/D-Bus, exactamente igual que Spotify.
- **Rainwave** — streaming directo de la radio comunitaria de música de videojuegos (6 estaciones).
- **RadioTunes** — streaming directo con tu cuenta premium (con tu `listen_key`), con submenús de canales favoritos y del catálogo completo (~99 canales).

```
♫  GameChops – Aryll's Theme
📻  Rainwave: Game
📻  RadioTunes: Chillout
```

## Características

- **Las cuatro fuentes visibles a la vez** en el menú (click derecho), con un ✓ marcando la activa
- **Rainwave**: submenú con sus 6 estaciones (All, Game, Chiptune, OC ReMix, Covers, Chill)
- **RadioTunes**: campo para tu `listen_key`, botón para marcar/quitar el canal actual de favoritos, submenú **Favoritos** y submenú **Todos los canales** (~99 disponibles)
- **Artista y título** de la canción actual en tiempo real (Spotify/Purrr vía MPRIS; Rainwave/RadioTunes vía metadata ICY del stream)
- **Click en el texto** → Spotify/Purrr: siguiente pista · Rainwave: siguiente estación · RadioTunes: siguiente favorito
- **Click en la carátula/ícono** → alterna play/pausa en cualquier fuente
- **Actualización instantánea** vía señales D-Bus en Spotify/Purrr (sin polling); sondeo liviano cada 5 s en modo radio
- Aparece solo cuando hay algo que mostrar; en Spotify/Purrr desaparece automáticamente al cerrar la app

## Cómo funciona

### Spotify

Spotify en Linux implementa el estándar **MPRIS2** (`org.mpris.MediaPlayer2`) sobre el bus de sesión D-Bus. La extensión:

1. Vigila el bus esperando que aparezca `org.mpris.MediaPlayer2.spotify`
2. Al detectarlo, crea un proxy D-Bus a la interfaz `org.mpris.MediaPlayer2.Player`
3. Se suscribe a la señal `PropertiesChanged` para recibir cambios en tiempo real
4. Lee `xesam:title`, `xesam:artist` y `PlaybackStatus` del campo `Metadata`
5. Llama a `Next` o `PlayPause` según el control pulsado

No se necesita ningún servidor local, userscript ni servicio systemd.

### Purrr

Purrr es un reproductor de música propio (GTK4/libadwaita, para Fedora) que reproduce MP3/FLAC cacheados desde Google Drive. Purrr expone un servidor **MPRIS2** (`org.mpris.MediaPlayer2.purrr`) — el mismo protocolo estándar que usa Spotify — así que la extensión lo trata exactamente igual, con el mismo código: vigila el bus, crea el proxy, se suscribe a `PropertiesChanged` y lee `xesam:title`/`xesam:artist`/`mpris:artUrl` del `Metadata`. No hace falta ninguna integración especial: cualquier reproductor que hable MPRIS2 correctamente (como Purrr) funciona con la extensión sin cambios adicionales.

### Rainwave y RadioTunes

GNOME Shell no tiene un motor de audio propio, así que para estas dos fuentes la extensión lanza **[mpv](https://mpv.io/)** como subproceso y lo controla mediante su socket IPC (play/stop y lectura de la metadata ICY del stream para mostrar artista/título). Es necesario tener mpv instalado:

```bash
sudo dnf install mpv
```

- **Rainwave** usa 6 URLs públicas de sintonización de rainwave.cc (All, Game, Chiptune, OC ReMix, Covers, Chill), sin necesidad de cuenta ni API key.
- **RadioTunes** no tiene una API pública documentada. Su cuenta premium sí ofrece, de forma oficial, un `listen_key` pensado para reproductores externos (VLC, Winamp, Sonos, etc.) — es lo mismo que usa la extensión, sin necesidad de guardar tu usuario/contraseña. La extensión combina ese `listen_key` con un catálogo interno de canales (~99, tomado de `listen.radiotunes.com/premium_high.json`) para construir la URL de cada uno: `http://listen.radiotunes.com/premium_high/<canal>.pls?listen_key=<tu_key>`. Para obtener tu `listen_key`:
  1. Entra a tu cuenta en [radiotunes.com](https://www.radiotunes.com) con tu suscripción premium activa.
  2. Busca la opción para reproducir en un reproductor externo / dispositivo (Winamp, VLC, Sonos, Squeezebox…) — suele estar en la configuración de la cuenta.
  3. Copia solo el `listen_key` (una cadena corta alfanumérica) de la URL de stream que te entrega.
  4. Pégalo en el menú de la extensión: click derecho → **RadioTunes** → campo de texto → Enter. Luego elige un canal desde **Favoritos** o **Todos los canales**.

  Si RadioTunes cambia este mecanismo en el futuro, o agrega/quita canales de su catálogo, avisa para actualizar la lista interna — la extensión no hace scraping en vivo del catálogo, lo tiene embebido.

## Requisitos

- Fedora 44 (o cualquier distro con GNOME Shell 45–50)
- Spotify instalado (versión de escritorio para Linux) — solo si usas esa fuente
- Purrr instalado y corriendo — solo si usas esa fuente
- `mpv` instalado — solo si usas Rainwave o RadioTunes

## Instalación

```bash
# Descomprimir en el directorio de extensiones
unzip powerzoid-music.zip \
  -d ~/.local/share/gnome-shell/extensions/

# Cerrar sesión y volver a entrar (necesario en Wayland)
gnome-session-quit --logout
```

Al iniciar sesión de nuevo:

```bash
gnome-extensions enable powerzoid-music@cleal.cl
```

### Instalación desde el repositorio

```bash
git clone https://github.com/ChristianLeal1978/powerzoid-music.git
cd powerzoid-music

# Copiar la extensión
cp -r powerzoid-music@cleal.cl \
  ~/.local/share/gnome-shell/extensions/

# Cerrar sesión y volver a entrar, luego:
gnome-extensions enable powerzoid-music@cleal.cl
```

## Actualizar una instalación existente

```bash
# Sobreescribir solo los archivos cambiados
cp -r powerzoid-music@cleal.cl \
  ~/.local/share/gnome-shell/extensions/

# Cerrar sesión y volver a entrar
gnome-session-quit --logout
```

## Desinstalar

```bash
gnome-extensions disable powerzoid-music@cleal.cl
rm -rf ~/.local/share/gnome-shell/extensions/powerzoid-music@cleal.cl
```

## Uso

| Acción | Resultado |
|--------|-----------|
| Click derecho | Abre el menú: Spotify / Purrr / Rainwave (6 estaciones) / RadioTunes (listen_key, favoritos, todos los canales), tamaño de letra |
| Click en el texto de la barra | Spotify/Purrr: siguiente pista · Rainwave: siguiente estación · RadioTunes: siguiente favorito |
| Click en la carátula/ícono del popup | Alterna play/pausa (todas las fuentes) |
| ☆/★ dentro del submenú RadioTunes | Añade o quita de favoritos el canal actualmente activo |

El texto se trunca automáticamente a 50 caracteres si es muy largo.

## Compatibilidad

| GNOME Shell | Fedora  | Estado |
|-------------|---------|--------|
| 50          | 44      | ✅ Probado |
| 48          | 42–43   | ✅ Compatible |
| 45–47       | 39–41   | ✅ Compatible |

## Estructura del proyecto

```
powerzoid-music@cleal.cl/
├── metadata.json   # UUID, nombre, versiones de GNOME Shell compatibles
├── extension.js    # Lógica completa: proxy D-Bus, UI, selector de fuente, controles
└── mpvPlayer.js     # Subproceso mpv + control IPC para Rainwave/RadioTunes
```

## Licencia

GPL-2.0 — ver [LICENSE](LICENSE)
