// src/core/config/store.js
// Lectura/escritura de archivos JSON en la carpeta de datos (no subida al repo).
// La carpeta se resuelve en runtime: data/ en dev, app.getPath('userData') en
// la app empaquetada (ver src/utils setDataRoot).

const fs = require('fs');
const path = require('path');
const { ensureDir, getDataRoot } = require('../../utils');

function dataDir() { return getDataRoot(); }
function configFile() { return path.join(dataDir(), 'config.json'); }     // overrides del usuario
function profilesFile() { return path.join(dataDir(), 'profiles.json'); }  // perfiles de juego

// Carga un JSON; si no existe o está corrupto, devuelve fallback.
function loadJson(file, fallback) {
  ensureDir(dataDir());
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, obj) {
  ensureDir(dataDir());
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8');
}

module.exports = { dataDir, configFile, profilesFile, loadJson, saveJson };
