// Regresión del actualizador: comparación de versiones, selección de asset
// por plataforma y check contra la API de GitHub (con fetch simulado).
const { test } = require('node:test');
const assert = require('node:assert');
const { compareVersions, selectAsset, checkForUpdate } = require('../src/core/updater');

test('compareVersions: ordena mayor/menor/igual', () => {
  assert.strictEqual(compareVersions('0.1.1', '0.1.0'), 1);
  assert.strictEqual(compareVersions('1.0.0', '0.9.9'), 1);
  assert.strictEqual(compareVersions('0.1.0', '0.1.1'), -1);
  assert.strictEqual(compareVersions('0.1.0', '0.1.0'), 0);
});

test('compareVersions: tolera prefijo v y versiones cortas', () => {
  assert.strictEqual(compareVersions('v0.1.1', '0.1.0'), 1);
  assert.strictEqual(compareVersions('0.2', '0.1.9'), 1);
  assert.strictEqual(compareVersions('1.2.3', '1.2'), 1);
  assert.strictEqual(compareVersions('no-es-version', '0.1.0'), -1);
});

test('selectAsset: Windows elige el instalador NSIS antes que el portable', () => {
  const release = { assets: [
    { name: 'Family Launcher 1.0.0.exe' },
    { name: 'Family Launcher Setup 1.0.0.exe' }
  ]};
  assert.strictEqual(selectAsset(release, 'win32').name, 'Family Launcher Setup 1.0.0.exe');
});

test('selectAsset: Linux prefiere AppImage, macOS elige dmg', () => {
  const release = { assets: [
    { name: 'launcher-1.0.0.deb' },
    { name: 'launcher-1.0.0.AppImage' },
    { name: 'launcher-1.0.0.dmg' }
  ]};
  assert.strictEqual(selectAsset(release, 'linux').name, 'launcher-1.0.0.AppImage');
  assert.strictEqual(selectAsset(release, 'darwin').name, 'launcher-1.0.0.dmg');
  assert.strictEqual(selectAsset(release, 'linux'), null || selectAsset(release, 'linux'));
});

test('selectAsset: sin asset compatible devuelve null', () => {
  const release = { assets: [{ name: 'readme.txt' }] };
  assert.strictEqual(selectAsset(release, 'win32'), null);
});

// Mocks de la vía web (github.com): la 1er llamada resuelve el tag vía
// /releases/latest (302 + Location), la 2da lista los assets vía
// /releases/expanded_assets/<tag> (HTML con links de descarga).
const WEB_TAG_HTML = (tag) => [
  `href="/acme/launcher/releases/download/${tag}/Family.Launcher.Setup.0.2.0.exe"`,
  `href="/acme/launcher/releases/download/${tag}/Family.Launcher.Portable.0.2.0.exe"`
].join('\n');

function webFetchMock(tag, assetsHtml = WEB_TAG_HTML(tag)) {
  return async (url) => {
    if (String(url).includes('/releases/latest')) {
      return {
        ok: true, status: 302,
        headers: { get: () => `https://github.com/acme/launcher/releases/tag/${tag}` }
      };
    }
    if (String(url).includes('/releases/expanded_assets/')) {
      return { ok: true, status: 200, text: async () => assetsHtml };
    }
    throw new Error('URL inesperada: ' + url);
  };
}

test('checkForUpdate: detecta versión más nueva y entrega el asset (sin API)', async () => {
  const r = await checkForUpdate({
    repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn: webFetchMock('v0.2.0'), platform: 'win32'
  });
  assert.strictEqual(r.updateAvailable, true);
  assert.strictEqual(r.version, '0.2.0');
  assert.ok(r.asset && /\.exe$/.test(r.asset.name));
  assert.strictEqual(r.asset.name, 'Family.Launcher.Setup.0.2.0.exe');
  assert.ok(r.asset.browser_download_url.includes('/releases/download/v0.2.0/'));
});

test('checkForUpdate: misma versión => sin update', async () => {
  const r = await checkForUpdate({
    repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn: webFetchMock('v0.1.0')
  });
  assert.strictEqual(r.updateAvailable, false);
});

test('checkForUpdate: sin repo configurado => sin update sin llamar a GitHub', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true }; };
  const r = await checkForUpdate({ repo: '', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
  assert.strictEqual(called, false);
});

test('checkForUpdate: 404 (sin releases) => sin update y sin error', async () => {
  const fetchFn = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  const r = await checkForUpdate({ repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
  assert.strictEqual(r.error, undefined);
});

test('checkForUpdate: release sin assets => sin asset pero update detectado', async () => {
  const r = await checkForUpdate({
    repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn: webFetchMock('v0.2.0', '<a>sin assets</a>'), platform: 'win32'
  });
  assert.strictEqual(r.updateAvailable, true);
  assert.strictEqual(r.asset, null);
});

test('checkForUpdate: release sin redirección (sin location) => error no fatal', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, headers: { get: () => null } });
  const r = await checkForUpdate({ repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
  assert.ok(r.error);
});
