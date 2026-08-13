// src/core/config/index.js
// Carga/guarda la configuración del launcher y gestiona perfiles.
// Fusiona config/default.json (proyecto) + data/config.json (usuario).

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { DEFAULT_CONFIG } = require('./defaults');
const { configFile, loadJson, saveJson } = require('./store');
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
  const user = loadJson(configFile(), {});
  return deepMerge(def, user);
}

// Guarda solo los overrides del usuario (no el default completo).
function saveConfig(partial) {
  const user = loadJson(configFile(), {});
  const merged = deepMerge(user, partial || {});
  saveJson(configFile(), merged);
  return loadConfig();
}

function getGameDirectory() {
  return resolvePath(loadConfig().gameDirectory);
}

// ID único por instalación. Identifica "quién" sube/borra/comparte skins en el
// backend (owner). Se genera la primera vez y se persiste en data/config.json.
function getDeviceId() {
  const user = loadJson(configFile(), {});
  if (user.deviceId && typeof user.deviceId === 'string') return user.deviceId;
  const id = crypto.randomUUID();
  saveJson(configFile(), { ...user, deviceId: id });
  return id;
}

module.exports = {
  loadConfig,
  saveConfig,
  getGameDirectory,
  getDeviceId,
  getProfiles: profiles.getProfiles,
  addProfile: profiles.addProfile,
  updateProfile: profiles.updateProfile,
  removeProfile: profiles.removeProfile,
  getSelectedProfile: profiles.getSelectedProfile,
  DEFAULT_CONFIG
};
