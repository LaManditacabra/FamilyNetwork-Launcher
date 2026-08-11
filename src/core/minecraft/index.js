// src/core/minecraft/index.js
// API pública de descarga y lanzamiento de Minecraft.
// Une manifest + cliente + libraries + assets + comando de ejecución.

const path = require('path');
const { VERSION_MANIFEST_V2, DIRS } = require('./constants');
const { getVersions, getVersionDetails, getLatest, getInstalledVersions } = require('./manifest');
const { downloadFile } = require('./downloader');
const { downloadLibraries, resolveLibraryPaths } = require('./libraries');
const { downloadAssets, downloadAssetIndex } = require('./assets');
const { buildLaunchCommand } = require('./launch');
const { ensureDir } = require('../../utils');

module.exports.VERSION_MANIFEST = VERSION_MANIFEST_V2;

module.exports.getVersions = getVersions;
module.exports.getVersionDetails = getVersionDetails;
module.exports.getLatest = getLatest;
module.exports.getInstalledVersions = getInstalledVersions;
module.exports.listInstalledLocalVersions = require('./manifest').listInstalledLocalVersions;
module.exports.removeInstalledVersion = require('./manifest').removeInstalledVersion;

// Descarga solo el jar del cliente de una versión.
async function downloadClient(versionId, gameDir, onProgress = null) {
  const details = await getVersionDetails(versionId, gameDir);
  const client = details.downloads && details.downloads.client;
  if (!client) throw new Error(`La versión ${versionId} no tiene cliente para descargar`);
  const dest = path.join(gameDir, DIRS.versions, versionId, `${versionId}.jar`);
  ensureDir(path.dirname(dest));
  await downloadFile(client.url, dest, {
    expectedSha1: client.sha1,
    onProgress: onProgress ? (c, t) => onProgress({ phase: 'client', current: c, total: t }) : null
  });
  return { dest, details };
}

// Descarga TODO lo necesario para jugar una versión:
// cliente + libraries + natives + assets. Devuelve los detalles y el classpath.
// onProgress({ phase, current, total }) donde phase es 'client'|'libraries'|'assets'.
async function downloadVersion(versionId, gameDir, onProgress = null) {
  const details = await getVersionDetails(versionId, gameDir);

  // 1) Cliente.
  const client = details.downloads && details.downloads.client;
  if (!client) throw new Error(`La versión ${versionId} no tiene cliente`);
  const clientDest = path.join(gameDir, DIRS.versions, versionId, `${versionId}.jar`);
  ensureDir(path.dirname(clientDest));
  await downloadFile(client.url, clientDest, {
    expectedSha1: client.sha1,
    onProgress: onProgress ? (c, t) => onProgress({ phase: 'client', current: c, total: t }) : null
  });

  // 2) Libraries + natives.
  const { classPath } = await downloadLibraries(details, gameDir, onProgress
    ? (c, t) => onProgress({ phase: 'libraries', current: c, total: t })
    : null);

  // 3) Assets.
  await downloadAssets(details, gameDir, onProgress
    ? (c, t) => onProgress({ phase: 'assets', current: c, total: t })
    : null);

  return { details, classPath, clientDest };
}

// Re-exporta el constructor del comando de lanzamiento.
module.exports.downloadClient = downloadClient;
module.exports.downloadVersion = downloadVersion;
module.exports.buildLaunchCommand = buildLaunchCommand;
module.exports.resolveLibraryPaths = resolveLibraryPaths;
module.exports.downloadLibraries = downloadLibraries;
module.exports.downloadAssets = downloadAssets;
module.exports.downloadAssetIndex = downloadAssetIndex;
module.exports.getClientJarPath = require('./launch').getClientJarPath;
