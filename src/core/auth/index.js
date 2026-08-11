// src/core/auth/index.js
// API pública de autenticación del launcher.
// Usa el flujo de Microsoft (microsoft.js) y persiste la cuenta (store.js).

const ms = require('./microsoft');
const store = require('./store');

// Inicia el login completo (abre navegador, captura code, obtiene perfil).
// Devuelve la cuenta { username, uuid, accessToken, refreshToken, expiresAt, skins }.
async function login(opts = {}) {
  const account = await ms.login(opts);
  store.saveAccount(account);
  return account;
}

// Valida que un access token siga siendo válido consultando el perfil.
// Devuelve true/false (no lanza).
async function validate(accessToken) {
  if (!accessToken) return false;
  try {
    await ms.getProfile(accessToken);
    return true;
  } catch {
    return false;
  }
}

// Si el token expiró, lo renueva usando el refresh token y actualiza el perfil.
// Devuelve la cuenta actualizada o lanza si no se puede renovar.
async function refresh(account, clientId = ms.DEFAULT_CLIENT_ID) {
  if (!account || !account.refreshToken) {
    throw new Error('No hay refresh token para renovar la sesión');
  }
  const tokens = await ms.refreshAccessToken(clientId, account.refreshToken);
  const xbox = await ms.authenticateXbox(tokens.access_token);
  const xsts = await ms.authorizeXsts(xbox.token);
  const mc = await ms.loginWithXbox(xsts.userhash, xsts.token);
  const profile = await ms.getProfile(mc.access_token);

  const updated = {
    ...account,
    username: profile.name,
    uuid: profile.id,
    accessToken: mc.access_token,
    refreshToken: tokens.refresh_token || account.refreshToken,
    expiresIn: mc.expires_in,
    expiresAt: Date.now() + (mc.expires_in || 0) * 1000,
    skins: profile.skins || account.skins
  };
  store.saveAccount(updated);
  return updated;
}

// Cierra sesión (borra la cuenta guardada).
function logout() {
  store.clearAccount();
}

// Devuelve la cuenta guardada (o null).
function getSavedAccount() {
  return store.loadAccount();
}

// Verifica si la cuenta guardada sigue vigente; si expiró, intenta refrescar.
// Devuelve la cuenta válida o null.
async function ensureValid() {
  const account = store.loadAccount();
  if (!account) return null;
  if (account.expiresAt && Date.now() < account.expiresAt) return account;
  try {
    return await refresh(account);
  } catch {
    return null;
  }
}

module.exports = { login, validate, refresh, logout, getSavedAccount, ensureValid, DEFAULT_CLIENT_ID: ms.DEFAULT_CLIENT_ID };
