// src/core/config/defaults.js
// Configuración por defecto del launcher.
// Se fusiona con config/default.json y con los datos de usuario en data/.

const DEFAULT_CONFIG = {
  // Carpeta donde se guardan las versiones, mods y perfiles.
  gameDirectory: '%APPDATA%/family-launcher/.minecraft',
  // Memoria asignada a Java (MB).
  memory: { min: 1024, max: 4096 },
  // Idioma de la interfaz.
  locale: 'es',
  // Si se muestran versiones de snapshot.
  showSnapshots: false,
  // Gestión de Java.
  java: { autoDownload: true },
  // Aplicar skins predefinidas en el servidor (endpoint HTTP del plugin helper).
  skinApi: { url: '', token: '' },
  // Skins client-side: authlib-injector contra el backend Yggdrasil (launcher_service).
  // api = base del funnel (p. ej. https://.../mc). enabled=false lo desactiva.
  yggdrasil: { enabled: true, api: '' },
  // ID del perfil de juego seleccionado (null = ninguno / usa el global).
  selectedProfileId: null,
  // Skin elegida de forma independiente al perfil (selector global; '' = default).
  selectedSkinId: '',
  // Actualizador del launcher: "owner/repo" de GitHub que publica las releases
  // (repo público: la descarga no necesita token). "" = actualizador desactivado.
  // dismissedVersion guarda la última versión que el usuario postergó, para no
  // volver a ofrecerla en cada apertura.
  updater: { repo: 'LaManditacabra/FamilyNetwork-Launcher', channel: 'latest', dismissedVersion: '' }
};

module.exports = { DEFAULT_CONFIG };
