// src/core/minecraft/constants.js
// URLs y nombres de carpetas usados para descargar Minecraft.

const VERSION_MANIFEST_V2 =
  'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

// Base para descargar libraries (si la library no trae su propia url).
const LIBRARIES_BASE = 'https://libraries.minecraft.net/';

// Base para descargar los objetos de assets (recursos).
const ASSETS_BASE = 'https://resources.download.minecraft.net/';

// Subcarpetas dentro del directorio del juego (.minecraft).
const DIRS = {
  versions: 'versions',
  libraries: 'libraries',
  assets: 'assets'
};

module.exports = { VERSION_MANIFEST_V2, LIBRARIES_BASE, ASSETS_BASE, DIRS };
