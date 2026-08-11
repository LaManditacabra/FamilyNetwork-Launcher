// src/core/auth/microsoft.js
// Flujo de autenticación de Minecraft vía Microsoft.
// Pasos: OAuth2 (Microsoft) -> Xbox Live -> XSTS -> Minecraft Services -> perfil.
// Ver: https://wiki.vg/Authentication

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

// Client ID público de Mojang (funciona con redirect loopback en localhost).
const DEFAULT_CLIENT_ID = '00000000402b5328';
const MS_AUTHORIZE = 'https://login.live.com/oauth20_authorize.srf';
const MS_TOKEN = 'https://login.live.com/oauth20_token.srf';
const XBOX_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_AUTH = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';
const SCOPE = 'XboxLive.signin offline_access';

// ----- Paso 1: URL de autorización -----
function getAuthorizationUrl(clientId, redirectUri, state) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    prompt: 'select_account'
  });
  return `${MS_AUTHORIZE}?${params.toString()}`;
}

// Servidor HTTP local que captura el "code" tras el login en el navegador.
function startAuthServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, `http://localhost:${port}`);
      } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body style="font-family:sans-serif;text-align:center;margin-top:20%">' +
          '<h2>Family Launcher</h2>' +
          '<p>Autenticación completada. Puedes cerrar esta pestaña.</p>' +
          '</body></html>'
        );
        server.close();
        resolve({ code, error: error || (errorDesc ? errorDesc : null) });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port);
  });
}

// Abre la URL en el navegador predeterminado del SO.
function openExternal(url) {
  let cmd;
  if (process.platform === 'win32') cmd = `cmd /c start "" "${url}"`;
  else if (process.platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  return new Promise((resolve) => {
    exec(cmd, (err) => resolve(!err));
  });
}

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

// ----- Paso 2: canjear code por tokens -----
async function exchangeCodeForToken(clientId, code, redirectUri) {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    scope: SCOPE
  });
  const res = await fetch(MS_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Error obteniendo token de Microsoft: ${res.status} ${txt}`);
  }
  return res.json();
}

// ----- Paso 2b: refrescar access token -----
async function refreshAccessToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPE
  });
  const res = await fetch(MS_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!res.ok) {
    throw new Error(`No se pudo refrescar el token (HTTP ${res.status})`);
  }
  return res.json();
}

// ----- Paso 3: Xbox Live user authenticate -----
async function authenticateXbox(microsoftAccessToken) {
  const res = await fetch(XBOX_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${microsoftAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  });
  if (!res.ok) throw new Error(`Xbox Live auth falló (HTTP ${res.status})`);
  const data = await res.json();
  const userhash = data.DisplayClaims.xui[0].uhs;
  return { token: data.Token, userhash };
}

// ----- Paso 4: XSTS authorize -----
async function authorizeXsts(xblToken) {
  const res = await fetch(XSTS_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  });
  if (!res.ok) throw new Error(`XSTS auth falló (HTTP ${res.status})`);
  const data = await res.json();
  return { token: data.Token, userhash: data.DisplayClaims.xui[0].uhs };
}

// ----- Paso 5: login en Minecraft Services -----
async function loginWithXbox(userhash, xstsToken) {
  const identityToken = `XBL3.0 x=${userhash};${xstsToken}`;
  const res = await fetch(MC_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityToken })
  });
  if (!res.ok) throw new Error(`Minecraft login falló (HTTP ${res.status})`);
  return res.json(); // { access_token, expires_in }
}

// ----- Paso 6: perfil del jugador -----
async function getProfile(minecraftAccessToken) {
  const res = await fetch(MC_PROFILE, {
    headers: { Authorization: `Bearer ${minecraftAccessToken}` }
  });
  if (res.status === 404) {
    // La cuenta de Microsoft existe pero no tiene Minecraft comprado.
    const err = new Error('Esta cuenta de Microsoft no tiene Minecraft comprado (no se encontró perfil).');
    err.code = 'NO_MINECRAFT';
    throw err;
  }
  if (!res.ok) throw new Error(`No se pudo obtener el perfil (HTTP ${res.status})`);
  return res.json(); // { id (uuid), name, skins, capes }
}

// Orquesta el flujo completo a partir de un authorization code.
async function finishLogin(code, clientId, redirectUri) {
  const ms = await exchangeCodeForToken(clientId, code, redirectUri);
  const xbox = await authenticateXbox(ms.access_token);
  const xsts = await authorizeXsts(xbox.token);
  const mc = await loginWithXbox(xsts.userhash, xsts.token);
  const profile = await getProfile(mc.access_token);

  return {
    username: profile.name,
    uuid: profile.id,
    accessToken: mc.access_token,
    refreshToken: ms.refresh_token,
    expiresIn: mc.expires_in,
    // Marca de tiempo de expiración aproximada (ms).
    expiresAt: Date.now() + (mc.expires_in || 0) * 1000,
    skins: profile.skins || []
  };
}

// Inicia el login: abre el navegador y espera el code en el loopback.
async function login({ clientId = DEFAULT_CLIENT_ID, port = 8080, openBrowser = true } = {}) {
  const redirectUri = `http://localhost:${port}/callback`;
  const state = randomState();
  const authUrl = getAuthorizationUrl(clientId, redirectUri, state);
  const pending = startAuthServer(port);
  if (openBrowser) await openExternal(authUrl);
  const { code, error } = await pending;
  if (error) throw new Error(`Login cancelado: ${error}`);
  return finishLogin(code, clientId, redirectUri);
}

module.exports = {
  DEFAULT_CLIENT_ID,
  getAuthorizationUrl,
  startAuthServer,
  openExternal,
  exchangeCodeForToken,
  refreshAccessToken,
  authenticateXbox,
  authorizeXsts,
  loginWithXbox,
  getProfile,
  finishLogin,
  login
};
