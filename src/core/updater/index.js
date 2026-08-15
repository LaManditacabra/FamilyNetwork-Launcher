// src/core/updater/index.js
// Actualizador del launcher vinculado a las releases de GitHub.
// Pura lógica Node (sin electron) para poder testearla; la parte "electron"
// (instalar y reiniciar) vive en src/main/updater.js.
//
// Los usuarios solo reciben las actualizaciones: el launcher consulta la
// release más reciente del repo configurado (config.updater.repo), compara la
// versión con la instalada (app.getVersion) y, si hay una más nueva, baja el
// instalador de la plataforma y lo aplica automáticamente.
//
// OJO: para que funcione sin ningún token, el repo debe ser PÚBLICO.

const fs = require('fs');

const GITHUB_WEB = 'https://github.com';
const GITHUB_API = 'https://api.github.com/repos';

// Convierte "v1.2.3", "1.2", "1.2.3-beta.1" en { major, minor, patch, pre }.
// Devuelve null si el texto no parece una versión.
function parseVersion(s) {
  const m = String(s || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] || 0), patch: Number(m[3] || 0) };
}

// Compara dos versiones "semver-ish". Devuelve >0 si a es más nueva, <0 si es
// más vieja, 0 si son iguales. Pre-releases ("1.2.3-beta") valen menos que la
// release estable del mismo número.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  return 0;
}

// Elige el asset de la release según la plataforma.
//  - Windows: instalador NSIS ("Setup ... .exe"); si no, cualquier .exe.
//  - Linux: .AppImage (corre en cualquier distro); si no, .deb.
//  - macOS: .dmg.
function selectAsset(release, platform) {
  const assets = (release && release.assets) || [];
  if (platform === 'win32') {
    return assets.find((a) => /\.exe$/i.test(a.name) && /setup/i.test(a.name))
      || assets.find((a) => /\.exe$/i.test(a.name))
      || null;
  }
  if (platform === 'linux') {
    return assets.find((a) => /\.AppImage$/i.test(a.name))
      || assets.find((a) => /\.deb$/i.test(a.name))
      || null;
  }
  if (platform === 'darwin') {
    return assets.find((a) => /\.dmg$/i.test(a.name)) || null;
  }
  return null;
}

// Consulta la última release del repo y decide si hay actualización.
// currentVersion: versión del launcher instalado (p. ej. "0.1.0").
// Devuelve { updateAvailable: false, error? } o { updateAvailable: true, ... }.
//
// Usa la VÍA WEB (github.com, sin token): la API de GitHub limita a 60
// peticiones/hora por IP y con varios launchers se agota. /releases/latest
// responde una redirección 302 al tag (no cuenta para el rate-limit) y
// /releases/expanded_assets/<tag> devuelve el HTML con los archivos adjuntos.
async function checkForUpdate({ repo, currentVersion, channel = 'latest', fetchFn = null, platform = null }) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { updateAvailable: false, error: 'repo de actualizaciones no configurado' };
  }
  const doFetch = fetchFn || globalThis.fetch;
  if (!doFetch) return { updateAvailable: false, error: 'fetch no disponible' };

  // 1) Resolver el tag de la última release sin pasar por la API.
  const latestRes = await doFetch(`${GITHUB_WEB}/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'family-launcher' },
    redirect: 'manual',
    signal: AbortSignal.timeout(12000)
  });
  if (latestRes.status === 404) return { updateAvailable: false };
  if (!latestRes.ok && latestRes.status !== 302 && latestRes.status !== 301) {
    throw new Error('GitHub devolvió HTTP ' + latestRes.status);
  }

  const location = latestRes.headers && latestRes.headers.get('location');
  const tagMatch = String(location || '').match(/\/releases\/tag\/([^/?#]+)/);
  if (!tagMatch) return { updateAvailable: false, error: 'no se pudo resolver la última release' };
  const tagName = tagMatch[1];
  const tag = tagName.replace(/^v/i, '');
  if (!tag) return { updateAvailable: false, error: 'release sin tag de versión' };

  // 2) Listar los assets de esa release (página web, sin API).
  const assetsPage = await doFetch(`${GITHUB_WEB}/${repo}/releases/expanded_assets/${tagName}`, {
    headers: { 'User-Agent': 'family-launcher' },
    signal: AbortSignal.timeout(12000)
  });
  const html = assetsPage.ok ? await assetsPage.text() : '';
  const assets = [];
  const seen = new Set();
  const assetRe = /href="([^"]*\/releases\/download\/[^"]+)"/g;
  let am;
  while ((am = assetRe.exec(html)) !== null) {
    const url = am[1];
    const name = decodeURIComponent(url.split('/').pop() || '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    assets.push({ name, browser_download_url: `${GITHUB_WEB}${url}`, size: 0 });
  }

  const updateAvailable = compareVersions(tag, currentVersion) > 0;
  return {
    updateAvailable,
    version: tag,
    tag: tagName,
    name: tagName,
    notes: '',
    url: `${GITHUB_WEB}/${repo}/releases/tag/${tagName}`,
    asset: updateAvailable ? selectAsset({ assets }, platform || process.platform) : null
  };
}

// Descarga el asset a dest con progreso { current, total }.
async function downloadAsset(asset, dest, onProgress = null) {
  const res = await fetch(asset.browser_download_url, { redirect: 'follow' });
  if (!res.ok) throw new Error('descarga falló (HTTP ' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const reader = res.body.getReader();
  const out = fs.createWriteStream(dest);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(Buffer.from(value));
    received += value.length;
    if (onProgress) onProgress({ current: received, total });
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  return dest;
}

// Nombre de archivo seguro para el asset descargado.
function safeAssetName(name) {
  return String(name || 'family-launcher-update').replace(/[^\w.\-]+/g, '_');
}

module.exports = {
  parseVersion,
  compareVersions,
  selectAsset,
  checkForUpdate,
  downloadAsset,
  safeAssetName
};
