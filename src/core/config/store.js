// src/core/config/store.js
// Lectura/escritura de archivos JSON en la carpeta data/ (no subida al repo).

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../../utils');

const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');     // overrides del usuario
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');  // perfiles de juego

// Carga un JSON; si no existe o está corrupto, devuelve fallback.
function loadJson(file, fallback) {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, obj) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
}

module.exports = { DATA_DIR, CONFIG_FILE, PROFILES_FILE, loadJson, saveJson };
