// src/core/config/index.js
// Carga/guarda la configuración del launcher y gestiona perfiles.
// Fusiona config/default.json (proyecto) + data/config.json (usuario).

const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG } = require('./defaults');
const { CONFIG_FILE, loadJson, saveJson } = require('./store');
const profiles = require('./profiles');
const { resolvePath } = require('../../utils');

// Ruta al config por defecto del proyecto.
const DEFAULT_FILE = path.resolve(__dirname, '..', '..', '..', 'config', 'default.json');

// Merge superficial de objetos (un nivel de profundidad para sub-objetos).
function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    const v = override[k];
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadConfig() {
  const def = fs.existsSync(DEFAULT_FILE)
    ? JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf-8'))
    : DEFAULT_CONFIG;
  const user = loadJson(CONFIG_FILE, {});
  return deepMerge(def, user);
}

// Guarda solo los overrides del usuario (no el default completo).
function saveConfig(partial) {
  const user = loadJson(CONFIG_FILE, {});
  const merged = deepMerge(user, partial || {});
  saveJson(CONFIG_FILE, merged);
  return loadConfig();
}

function getGameDirectory() {
  return resolvePath(loadConfig().gameDirectory);
}

module.exports = {
  loadConfig,
  saveConfig,
  getGameDirectory,
  getProfiles: profiles.getProfiles,
  addProfile: profiles.addProfile,
  updateProfile: profiles.updateProfile,
  removeProfile: profiles.removeProfile,
  getSelectedProfile: profiles.getSelectedProfile,
  DEFAULT_CONFIG
};
