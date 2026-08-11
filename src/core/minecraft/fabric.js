// src/core/minecraft/fabric.js
// Instala el loader Fabric para una versión de Minecraft sin ejecutar Java.
// Usa meta.fabricmc.net para armar un version.json completo (cliente vanilla +
// libraries de Fabric) que el launcher descarga y lanza como cualquier otra.

const fs = require('fs');
const path = require('path');
const { DIRS } = require('./constants');
const { getVersionDetails } = require('./manifest');
const { downloadLibraries, mavenArtifactPath, dedupeLibraries } = require('./libraries');
const { ensureDir } = require('../../utils');

const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader';
const FABRIC_MAVEN = 'https://maven.fabricmc.net/';

// Devuelve el id de la versión base de Minecraft a partir de una id (p. ej.
// "1.21.1-fabric-0.16.9" -> "1.21.1"). Para ids vanilla devuelve la misma.
function gameVersionOf(versionId) {
  const idx = String(versionId).indexOf('-fabric-');
  return idx === -1 ? String(versionId) : String(versionId).slice(0, idx);
}

// ¿Es esta id una versión de Fabric instalada localmente?
function isFabricId(versionId) {
  return String(versionId).includes('-fabric-');
}

// Pide a meta.fabricmc.net el loader estable más reciente para un juego.
async function fetchLoaderMeta(minecraftVersion) {
  const res = await fetch(`${FABRIC_META}/${encodeURIComponent(minecraftVersion)}`);
  if (!res.ok) {
    throw new Error(`Fabric no soporta ${minecraftVersion} aún (HTTP ${res.status})`);
  }
  const list = await res.json();
  // Estables primero, luego por build desc. El meta devuelve el más nuevo arriba.
  const stable = list.filter((x) => x.loader && x.loader.stable);
  const choice = (stable.length ? stable : list)[0];
  if (!choice || !choice.loader) {
    throw new Error('No hay un loader Fabric disponible para ' + minecraftVersion);
  }
  return choice;
}

// Convierte una library del meta de Fabric al formato Mojang (downloads.artifact)
// para que `downloadLibraries`/`resolveLibraryPaths` la entiendan igual.
function toMojangLibrary(lib) {
  const rules = lib.rules || null;
  let expectedSha1 = null;
  if (lib.checksums && Array.isArray(lib.checksums)) {
    expectedSha1 = lib.checksums.find((c) => /^[0-9a-f]{40}$/i.test(c)) || null;
  }
  if (lib.downloads && lib.downloads.artifact) {
    const a = lib.downloads.artifact;
    return { name: lib.name, rules, downloads: { artifact: { path: a.path, url: a.url, sha1: a.sha1 || expectedSha1 } } };
  }
  const rel = mavenArtifactPath(lib.name);
  const urlBase = String(lib.url || FABRIC_MAVEN).replace(/\/+$/, '');
  return {
    name: lib.name,
    rules,
    downloads: { artifact: { path: rel, url: urlBase + '/' + rel, sha1: expectedSha1 } }
  };
}

// Descarga el manifest del loader y construye una versión "fabric" completa.
// Devuelve { id, details } con el version.json listo para descargar/y lanzar.
async function buildFabricVersion(minecraftVersion) {
  const meta = await fetchLoaderMeta(minecraftVersion);
  const loaderVer = meta.loader.version;
  const id = `${minecraftVersion}-fabric-${loaderVer}`;

  const launcherMeta = meta.launcherMeta || {};
  const fabricLibs = [
    ...(launcherMeta.libraries && launcherMeta.libraries.common || []),
    ...(launcherMeta.libraries && launcherMeta.libraries.client || [])
  ].map(toMojangLibrary);

  // El meta v2 no incluye los dos jars principales (fabric-loader e
  // intermediary): se suman aparte desde su maven.
  const loaderMaven = (meta.loader && (meta.loader.maven || `net.fabricmc:fabric-loader:${loaderVer}`))
    || `net.fabricmc:fabric-loader:${loaderVer}`;
  const intermediaryMaven = (meta.intermediary && (meta.intermediary.maven || `net.fabricmc:intermediary:${minecraftVersion}`))
    || `net.fabricmc:intermediary:${minecraftVersion}`;
  const coreLibs = [toMojangLibrary({ name: intermediaryMaven, url: FABRIC_MAVEN }),
    toMojangLibrary({ name: loaderMaven, url: FABRIC_MAVEN })];

  const mainClass =
    (launcherMeta.mainClass && launcherMeta.mainClass.client) ||
    'net.fabricmc.loader.impl.launch.knot.KnotClient';

  // Version vanilla base: aporta cliente, assets y argumentos del juego.
  const vanilla = await getVersionDetails(minecraftVersion);

  const details = {
    id,
    time: new Date().toISOString(),
    releaseTime: new Date().toISOString(),
    type: 'release',
    minimumLauncherVersion: vanilla.minimumLauncherVersion,
    mainClass,
    arguments: vanilla.arguments,
    assetIndex: vanilla.assetIndex,
    assets: vanilla.assets,
    // Apuntamos el cliente al jar de nuestra carpeta de versión fabric.
    downloads: {
      ...(vanilla.downloads || {}),
      client: { ...((vanilla.downloads && vanilla.downloads.client) || {}), path: `versions/${id}/${id}.jar` }
    },
    javaVersion: vanilla.javaVersion,
    libraries: dedupeLibraries([coreLibs, fabricLibs, vanilla.libraries || []])
  };

  return { id, details, loaderVersion: loaderVer };
}

// Instala la versión Fabric: escribe el version.json en disco y descarga el
// cliente. Se devuelve el id de la versión lista para lanzar.
// onProgress({ phase:'fabric', current, total }).
async function installFabric(minecraftVersion, gameDir, onProgress = null) {
  const { id, details } = await buildFabricVersion(minecraftVersion);
  const versionDir = path.join(gameDir, DIRS.versions, id);
  ensureDir(versionDir);
  const jsonPath = path.join(versionDir, `${id}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(details, null, 2));

  // Descarga cliente + libraries con el mismo pipeline de las versiones vanilla.
  const { downloadFile, fileSha1 } = require('./downloader');
  const client = details.downloads && details.downloads.client;
  if (!client) throw new Error('La versión base sin cliente disponible');

  const clientJar = path.join(versionDir, `${id}.jar`);
  if (fileSha1(clientJar) !== client.sha1) {
    await downloadFile(client.url, clientJar, {
      expectedSha1: client.sha1,
      onProgress: onProgress ? (c, t) => onProgress({ phase: 'fabric', current: c, total: t }) : null
    });
  }

  await downloadLibraries(details, gameDir, (done, total) => {
    if (onProgress) onProgress({ phase: 'fabric-libs', current: done, total: total + 1 });
  });

  return { id, details };
}

module.exports = { installFabric, buildFabricVersion, gameVersionOf, isFabricId, fetchLoaderMeta };