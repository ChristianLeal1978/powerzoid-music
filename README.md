# Spotify Now Playing — GNOME Shell Extension

Extensión para GNOME Shell que muestra en la barra superior el artista y título de la canción que se está reproduciendo en Spotify, con controles de reproducción integrados.

```
♫  GameChops – Aryll's Theme   ⏸
```

## Características

- **Artista y título** de la canción actual en tiempo real
- **Ícono de estado** que refleja si Spotify está reproduciendo (`▶`) o pausado (`⏸`)
- **Click en el texto** → salta a la siguiente pista
- **Click en el ícono** → alterna entre play y pausa
- **Actualización instantánea** vía señales D-Bus (sin polling)
- **Sin dependencias externas** — usa el protocolo MPRIS2 que Spotify implementa de forma nativa en Linux
- Aparece solo cuando Spotify está abierto; desaparece automáticamente al cerrarlo

## Cómo funciona

Spotify en Linux implementa el estándar **MPRIS2** (`org.mpris.MediaPlayer2`) sobre el bus de sesión D-Bus. La extensión:

1. Vigila el bus esperando que aparezca `org.mpris.MediaPlayer2.spotify`
2. Al detectarlo, crea un proxy D-Bus a la interfaz `org.mpris.MediaPlayer2.Player`
3. Se suscribe a la señal `PropertiesChanged` para recibir cambios en tiempo real
4. Lee `xesam:title`, `xesam:artist` y `PlaybackStatus` del campo `Metadata`
5. Llama a `Next` o `PlayPause` según el control pulsado

No se necesita ningún servidor local, userscript ni servicio systemd.

## Requisitos

- Fedora 44 (o cualquier distro con GNOME Shell 45–50)
- Spotify instalado (versión de escritorio para Linux)
- Sin dependencias adicionales

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

## Desinstalar

```bash
gnome-extensions disable spotify-now-playing@cleal.cl
rm -rf ~/.local/share/gnome-shell/extensions/spotify-now-playing@cleal.cl
```

## Uso

| Acción | Resultado |
|--------|-----------|
| Click en el texto de la canción | Salta a la siguiente pista |
| Click en `▶` / `⏸` | Alterna entre reproducir y pausar |

El texto se trunca automáticamente a 50 caracteres si el título es muy largo.

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
└── extension.js    # Lógica completa: proxy D-Bus, UI, controles
```

## Licencia

GPL-2.0 — ver [LICENSE](LICENSE)
