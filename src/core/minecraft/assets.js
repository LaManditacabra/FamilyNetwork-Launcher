// src/core/minecraft/assets.js
// Descarga el índice de assets y los objetos (recursos) de Minecraft.

const path = require('path');
const fs = require('fs');
const { ASSETS_BASE, DIRS } = require('./constants');
const { downloadFile } = require('./downloader');
const { ensureDir } = require('../../utils');

// Descarga el JSON del índice de assets a assets/indexes/<name>.json
// y devuelve { name, indexPath }.
async function downloadAssetIndex(versionDetails, gameDir) {
  const assetInfo = versionDetails.assetIndex || (versionDetails.assets
    ? { id: versionDetails.assets, url: null, sha1: null }
    : null);
  if (!assetInfo) throw new Error('Esta versión no define assetIndex');

  const name = assetInfo.id;
  const indexPath = path.join(gameDir, DIRS.assets, 'indexes', `${name}.json`);

  if (assetInfo.url) {
    await downloadFile(assetInfo.url, indexPath, { expectedSha1: assetInfo.sha1 || null });
  } else {
    // Versiones muy viejas: intentan descargar por id (no siempre aplica).
    throw new Error(`assetIndex sin url para la versión ${versionDetails.id}`);
  }

  return { name, indexPath };
}

// Descarga todos los objetos de assets listados en el índice.
async function downloadAssets(versionDetails, gameDir, onProgress = null) {
  const { indexPath } = await downloadAssetIndex(versionDetails, gameDir);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const objects = index.objects || {};

  const keys = Object.keys(objects);
  const total = keys.length;
  let done = 0;

  for (const key of keys) {
    const obj = objects[key];
    const hash = obj.hash;
    const sub = hash.slice(0, 2);
    const url = `${ASSETS_BASE}${sub}/${hash}`;
    const dest = path.join(gameDir, DIRS.assets, 'objects', sub, hash);
    await downloadFile(url, dest, { expectedSha1: hash });
    done++;
    if (onProgress) onProgress(done, total);
  }

  return { name: index.id || versionDetails.assetIndex.id, count: total };
}

module.exports = { downloadAssetIndex, downloadAssets };
