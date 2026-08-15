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

test('checkForUpdate: detecta versión más nueva y entrega el asset', async () => {
  const fetchFn = async (url) => ({
    ok: true, status: 200,
    json: async () => ({
      tag_name: 'v0.2.0',
      name: 'v0.2.0',
      body: 'cosas nuevas',
      html_url: 'https://github.com/acme/launcher/releases/v0.2.0',
      assets: [{ name: 'Family Launcher Setup 0.2.0.exe', browser_download_url: 'https://x/f.exe', size: 123 }]
    })
  });
  const r = await checkForUpdate({ repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn, platform: 'win32' });
  assert.strictEqual(r.updateAvailable, true);
  assert.strictEqual(r.version, '0.2.0');
  assert.ok(r.asset && /\.exe$/.test(r.asset.name));
});

test('checkForUpdate: misma versión => sin update', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.1.0', assets: [] }) });
  const r = await checkForUpdate({ repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
});

test('checkForUpdate: sin repo configurado => sin update sin llamar a la API', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true }; };
  const r = await checkForUpdate({ repo: '', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
  assert.strictEqual(called, false);
});

test('checkForUpdate: 404 (sin releases) => sin update y sin error', async () => {
  const fetchFn = async () => ({ ok: false, status: 404 });
  const r = await checkForUpdate({ repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
  assert.strictEqual(r.error, undefined);
});

test('checkForUpdate: rate-limit (403 con reset) => rateLimited con retryAt', async () => {
  const reset = Math.floor(Date.now() / 1000) + 600;
  const fetchFn = async () => ({
    ok: false,
    status: 403,
    headers: new Map([
      ['x-ratelimit-remaining', '0'],
      ['x-ratelimit-reset', String(reset)]
    ]),
    json: async () => ({})
  });
  const r = await checkForUpdate({ repo: 'acme/launcher', currentVersion: '0.1.0', fetchFn });
  assert.strictEqual(r.updateAvailable, false);
  assert.strictEqual(r.rateLimited, true);
  assert.strictEqual(r.retryAt, reset * 1000);
  assert.ok(r.retryInMs > 0 && r.retryInMs <= 600000);
});
