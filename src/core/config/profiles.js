// src/core/config/profiles.js
// CRUD de perfiles de juego (cada uno guarda versión, nombre, memoria y skin).

const { PROFILES_FILE, loadJson, saveJson } = require('./store');

function getProfiles() {
  return loadJson(PROFILES_FILE, []);
}

function saveProfiles(profiles) {
  saveJson(PROFILES_FILE, profiles);
}

// Crea un perfil. versionId y skin son opcionales.
function addProfile({ name, versionId = null, memory = null, skin = '' }) {
  const profiles = getProfiles();
  const id = 'p_' + Date.now().toString(36);
  const profile = { id, name: name || 'Perfil', versionId, memory, skin };
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

function updateProfile(id, patch) {
  const profiles = getProfiles();
  const i = profiles.findIndex((p) => p.id === id);
  if (i < 0) return null;
  profiles[i] = { ...profiles[i], ...patch, id };
  saveProfiles(profiles);
  return profiles[i];
}

function removeProfile(id) {
  const rest = getProfiles().filter((p) => p.id !== id);
  saveProfiles(rest);
}

// Devuelve el perfil seleccionado, o el primero, o null.
function getSelectedProfile(selectedId) {
  const profiles = getProfiles();
  if (!profiles.length) return null;
  return profiles.find((p) => p.id === selectedId) || profiles[0];
}

module.exports = { getProfiles, saveProfiles, addProfile, updateProfile, removeProfile, getSelectedProfile };
