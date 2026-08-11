# FAMILY LAUNCHER

Launcher de Minecraft de escritorio, multiplataforma (Windows / Linux / macOS).

## Tecnología
- **Electron**: ventana y proceso principal (Desktop).
- **Node.js**: lógica del launcher (descargas, autenticación, Java, perfiles).
- **HTML / CSS / JS**: interfaz de usuario (renderer).

## Estructura
```
FAMILY LAUNCHER/
├── package.json            # Dependencias y scripts del proyecto
├── config/
│   └── default.json        # Configuración por defecto
├── data/                   # Datos locales (cuentas, perfiles) - no subir al repo
├── assets/                 # Iconos e imágenes
└── src/
    ├── main/               # Proceso principal de Electron
    │   ├── index.js        # Punto de entrada (crea la ventana)
    │   ├── window.js       # Configuración de la BrowserWindow
    │   └── ipc/            # Canales de comunicación main <-> renderer
    ├── renderer/           # Interfaz (lo que ve el usuario)
    │   ├── index.html
    │   ├── css/
    │   ├── js/
    │   └── assets/
    ├── core/               # Lógica del launcher
    │   ├── auth/           # Inicio de sesión / cuentas (Mojang, Microsoft)
    │   ├── minecraft/      # Versiones, descarga de cliente y assets
    │   ├── java/           # Gestión del runtime de Java
    │   └── config/         # Carga/guardado de configuración
    └── utils/              # Funciones auxiliares (descarga, hash, paths)
```

## Estado
- Estructura base y UI (renderer) creadas.
- **`core/minecraft` implementado y verificado**: descarga del manifest de versiones,
  cliente, libraries y natives, assets, y construcción del comando de lanzamiento.
  (Probado: 1.20.1 descarga cliente + 64 libraries y arma el comando correcto.)
- **`core/auth` implementado**: login Microsoft completo (OAuth2 + Xbox Live + XSTS +
  Minecraft Services), refresh de token, validación, y guardado de la cuenta.
  La lógica base se verificó (carga, validate, ensureValid).
- **Integración IPC**: `main/ipc/handlers.js` + `renderer/js/preload.js` exponen
  login, logout, getAccount, getVersions, getLatest y launch a la UI.
- **`core/java` implementado**: detecta Java en PATH/carpetas comunes, calcula el major
  requerido por versión de MC (1.17+ → 17, previas → 8), y descarga un JRE desde
  Adoptium si no hay uno compatible. Integrado en `minecraft:launch` vía `ensureJava`.
- **`core/config` implementado**: fusiona `config/default.json` + `data/config.json`
  (overrides del usuario), resuelve `%APPDATA%`, y gestiona perfiles de juego
  (CRUD en `data/profiles.json`). Integrado en la UI (panel de perfiles).
- **UI pulida**: sidebar con cuenta (avatar de la skin) y perfiles, panel principal de
  juego con versión destacada ("Última versión"), barra de progreso, y controles de
  ventana (minimizar/maximizar/cerrar) porque la ventana es sin bordes (`frame: false`).
- **Empaquetado configurado** con `electron-builder` (ver abajo). Incluye icono propio
  en `assets/icons/icon.png`.
- **Actualizador automático** (`core/updater`): consulta las releases de GitHub, compara
  la versión instalada y le ofrece al usuario descargar/instalar la nueva con un clic.
  El repo se configura en `config.updater.repo` (p. ej. `"katherine/family-launcher"`).
- Pendiente: publicación del repo (el launcher no es repo git todavía) y primer release.

## Actualizador (releases de GitHub)
El launcher le avisa al usuario cuando hay una versión nueva y la instala automáticamente.

- **Check**: al abrir la app, `updater:check` consulta
  `GET https://api.github.com/repos/{owner}/{repo}/releases/latest` y compara el
  `tag_name` (p. ej. `v0.2.0`) con la versión instalada (`app.getVersion()`).
- **Repo**: se configura en `config.updater.repo` como `"owner/name"`. Vacío o sin repo
  = actualizador desactivado (el check devuelve sin error y sin aviso).
  **Importante: el repo debe ser PÚBLICO** para que la descarga funcione sin token.
- **Descarga**: `updater:download` baja el instalador de la plataforma con barra de
  progreso:
  - Windows: el `.exe` que contenga "Setup" (NSIS); si no, cualquier `.exe`.
  - Linux: `.AppImage` (preferido) o `.deb`.
  - macOS: `.dmg`.
- **Aplicar**: Windows lanza el instalador NSIS en silencio (`/S`) y cierra la app;
  Linux reemplaza el AppImage actual (`$APPIMAGE`) y relanza. En macOS y en dev
  (app sin empaquetar) solo abre/ubica el archivo descargado.
- **Postergar**: "Más tarde" guarda la versión en `config.updater.dismissedVersion`
  y no se vuelve a ofrecer hasta que salga otra.

### Cómo publicar una versión nueva
1. Subí la versión en `package.json`.
2. `npm run build:win` (y `build:linux`/`build:mac` si hace falta) → instaladores en `dist/`.
3. Creá una **release** en GitHub con tag `vX.Y.Z` y subí los instaladores de `dist/`
   como assets (el `.exe` de NSIS con "Setup" en el nombre, el `.AppImage`, el `.dmg`).

## Empaquetado (electron-builder)
Scripts en `package.json`:
- `npm run pack` — empaqueta sin instalador (modo directorio).
- `npm run build:win` — genera `.exe` portable y instalador NSIS.
- `npm run build:linux` — AppImage y `.deb`.
- `npm run build:mac` — `.dmg`.

La configuración `build` define `appId`, `productName`, los `files` a incluir
(`src/`, `config/`, `package.json`) y el icono para cada SO. Win/Linux/Mac usan
`assets/icons/icon.png`.

> Nota: `electron-builder` descarga el binario de Electron desde GitHub. En el entorno
> de desarrollo aquí usado la red entrega un binario incorrecto, así que el build se
> debe correr en una máquina con acceso normal a GitHub (`npm install` previo).

## Módulo `core/auth` (cuenta Microsoft)
- `microsoft.js` — flujo OAuth2: `getAuthorizationUrl`, `startAuthServer` (loopback que
  captura el `code`), `exchangeCodeForToken`, `refreshAccessToken`, `authenticateXbox`,
  `authorizeXsts`, `loginWithXbox`, `getProfile`, `finishLogin`, `login`.
- `store.js` — guarda/carga la cuenta en `data/accounts.json` (en `.gitignore`).
- `index.js` — API pública: `login()`, `validate(token)`, `refresh(account)`,
  `logout()`, `getSavedAccount()`, `ensureValid()`.
- Client ID por defecto: `00000000402b5328` (Mojang). Si tu app de Azure lo requiere,
  pásalo en `login({ clientId, port })`.
- `constants.js` — URLs base y carpetas.
- `manifest.js` — `getVersions(showSnapshots)`, `getVersionDetails(id)`, `getLatest()`.
- `downloader.js` — `downloadFile(url, dest, { expectedSha1, onProgress })` con hash SHA1 y skip si ya existe.
- `libraries.js` — resuelve libraries por SO/arquitectura y descarga/extrae natives.
- `assets.js` — descarga índice y objetos de assets.
- `launch.js` — `buildLaunchCommand(...)` arma `java -cp ... mainClass ...` con variables estándar.
- `zip.js` (utils) — extractor ZIP mínimo para los natives (sin dependencias).
- `index.js` — API pública: `downloadVersion(id, gameDir, onProgress)`, `downloadClient(...)`,
  `buildLaunchCommand(...)`, etc. `onProgress` recibe `{ phase, current, total }`.

## Módulo `core/java` (runtime de Java)
- `parseMajor(text)` — extrae el major de `java -version` ("1.8.0_401" → 8, "17.0.10" → 17).
- `requiredMajorForVersion(id)` — 1.17+ → 17; previas → 8; releases modernas → 17.
- `findJava()` — busca Java en PATH y en carpetas comunes por SO; devuelve `{ path, major }`.
- `downloadJava(major, gameDir, onProgress)` — descarga JRE desde Adoptium y lo extrae.
- `ensureJava(versionId, gameDir, onProgress)` — usa uno compatible instalado o descarga.
  Integrado en el handler `minecraft:launch`.

## Módulo `core/config` (configuración y perfiles)
- `defaults.js` — `DEFAULT_CONFIG` (gameDirectory, memory, locale, showSnapshots, java, selectedProfileId).
- `store.js` — lectura/escritura JSON en `data/` (`config.json`, `profiles.json`).
- `profiles.js` — CRUD de perfiles: `addProfile`, `updateProfile`, `removeProfile`, `getSelectedProfile`.
- `index.js` — `loadConfig()` fusiona `config/default.json` + `data/config.json`;
  `saveConfig(partial)` guarda solo overrides; `getGameDirectory()` resuelve `%APPDATA%`.
- Integrado en la UI: panel de perfiles (guardar/seleccionar/eliminar) y canal `config:get`.

## Puesta en marcha (próximos pasos)
1. `npm install` para instalar Electron y dependencias.
2. Implementar `core/config` para leer `config/default.json`.
3. Implementar `core/auth` (login con Microsoft/Mojang).
4. Implementar `core/minecraft` (lista de versiones y descarga).
5. Construir la UI en `renderer`.

## Nota sobre la instalación en este entorno
La descarga del binario de Electron se hace desde los servidores de GitHub. En redes con
proxy que intercepta esas descargas, npm puede bajar un binario incorrecto (por ejemplo un
Node.js en lugar de Electron), lo que causa el error:
`TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')`
Si ves ese error, borra `node_modules/electron` y la caché (`%LOCALAPPDATA%\electron\Cache`)
e instala de nuevo en una red con acceso normal a GitHub. En ese entorno `npm start` abre la
ventana correctamente.
