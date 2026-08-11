// src/core/minecraft/manifest.js
// Descarga y parsea el manifest de versiones de Minecraft y los
// detalles de una versión concreta.

const fs = require('fs');
const path = require('path');
const { VERSION_MANIFEST_V2, DIRS } = require('./constants');

// Cache en memoria del manifest para no descargarlo en cada llamada.
let manifestCache = null;
// Cache local de detalles resueltos (con inheritsFrom ya aplicado).
const detailsCache = new Map();

async function getVersionManifest() {
  if (manifestCache) return manifestCache;
  const res = await fetch(VERSION_MANIFEST_V2);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el manifest (HTTP ${res.status})`);
  }
  manifestCache = await res.json();
  return manifestCache;
}

// Devuelve la lista de versiones disponibles.
// showSnapshots=false -> solo releases (y la última snapshot si quisieras).
// Incluye { id, type, releaseTime, url }.
async function getVersions(showSnapshots = false) {
  const manifest = await getVersionManifest();
  const list = manifest.versions.map((v) => ({
    id: v.id,
    type: v.type,
    releaseTime: v.releaseTime,
    url: v.url
  }));

  if (showSnapshots) return list;

  // Filtra snapshots, betas y alphas viejos; deja releases.
  return list.filter((v) => v.type === 'release');
}

// Devuelve el objeto "latest" del manifest (release y snapshot más recientes).
async function getLatest() {
  const manifest = await getVersionManifest();
  return manifest.latest; // { release, snapshot }
}

// Carga el JSON local de una versión instalada en disco (p. ej. Fabric).
function loadLocalVersion(gameDir, versionId) {
  const file = path.join(gameDir, DIRS.versions, versionId, `${versionId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// Marca que identifica una versión con loader instalada: "<mc>-<loader>-<ver>".
const LOADER_ID_RE = /-(fabric|forge|neoforge)-\S+/;

// Lista las versiones personalizadas (fabric, forge, neoforge) instaladas en
// disco, incluyendo su tipo de loader.
function getInstalledVersions(gameDir) {
  const versionsDir = path.join(gameDir, DIRS.versions);
  if (!fs.existsSync(versionsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const json = loadLocalVersion(gameDir, entry.name);
    if (!json) continue;
    const m = String(json.id).match(LOADER_ID_RE);
    if (m) {
      out.push({
        id: json.id,
        type: m[1],
        releaseTime: json.releaseTime || null
      });
    }
  }
  return out;
}

// Tamaño (bytes) que ocupa una versión en disco (json + jar + natives).
function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += dirSize(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    }
  } catch { /* directorio ilegible */ }
  return total;
}

// Lista TODAS las versiones con datos locales en disco (vanillas bajadas +
// loaders fabric/forge/neoforge), para gestionarlas (p. ej. desinstalar).
// Una versión cuenta como instalada si su carpeta tiene el <id>.json (loaders)
// o el jar del cliente <id>.jar (las vanilla no guardan json, solo el jar).
function listInstalledLocalVersions(gameDir) {
  const versionsDir = path.join(gameDir, DIRS.versions);
  if (!fs.existsSync(versionsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(versionsDir, entry.name);
    const json = loadLocalVersion(gameDir, entry.name);
    const hasClient = fs.existsSync(path.join(dirPath, entry.name + '.jar'));
    if (!json && !hasClient) continue;
    const id = (json && json.id) || entry.name;
    const m = String(id).match(LOADER_ID_RE);
    out.push({
      id,
      type: m ? m[1] : (json && json.type) || 'release',
      releaseTime: (json && json.releaseTime) || null,
      sizeBytes: dirSize(dirPath)
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Elimina del disco la carpeta de una versión instalada (json + jar + natives).
// Devuelve true si existía y se borró.
function removeInstalledVersion(gameDir, versionId) {
  const dir = path.join(gameDir, DIRS.versions, versionId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// Descarga el JSON detallado de una versión (cliente, libraries, assets, etc).
// Si gameDir se pasa y la versión está instalada localmente, usa ese JSON
// (resolviendo el "inheritsFrom" de los loaders Forge/NeoForge: sus version.json
// heredan cliente, assets, javaVersion y libraries de la versión vanilla base).
async function getVersionDetails(versionId, gameDir = null) {
  if (gameDir) {
    const cacheKey = gameDir + '|' + versionId;
    if (detailsCache.has(cacheKey)) return detailsCache.get(cacheKey);

    const local = loadLocalVersion(gameDir, versionId);
    if (local) {
      const details = local.inheritsFrom
        ? resolveInheritance(local, await getVersionDetails(local.inheritsFrom, gameDir), versionId)
        : local;
      detailsCache.set(cacheKey, details);
      return details;
    }
  }
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) {
    throw new Error(`Versión "${versionId}" no encontrada en el manifest`);
  }
  const res = await fetch(entry.url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la versión ${versionId} (HTTP ${res.status})`);
  }
  return res.json();
}

// Combina los jvm args del loader con los de la base (los loaders no traen
// el natives_directory y algunos flags de Mojang; se agregan sin duplicar).
function mergeJvmArgs(childJvm, baseJvm) {
  if (!childJvm) return baseJvm;
  if (!baseJvm) return childJvm;
  const prefixOf = (token) => {
    if (typeof token !== 'string') return null;
    const eq = token.indexOf('=');
    return eq === -1 ? token : token.slice(0, eq + 1);
  };
  const have = new Set();
  for (const a of childJvm) {
    const p = prefixOf(a);
    if (p) have.add(p);
  }
  const extra = [];
  for (const a of baseJvm) {
    const p = prefixOf(a);
    if (!p || !have.has(p)) extra.push(a);
  }
  return [...childJvm, ...extra];
}

// Combina los game args del loader con los de la base: NeoForge/Forge solo
// aportan sus "--fml.*" y DEJAN los vanilla ("--accessToken", "--version", …)
// en la base; si se usara solo el del hijo, el cliente NeoForge fallaría por
// opciones obligatorias faltantes. Se deduplica por flag ("--<nombre>").
function mergeGameArgs(childGame, baseGame) {
  if (!baseGame) return childGame;
  if (!childGame) return baseGame;
  const seen = new Set();
  const out = [];
  for (const args of [baseGame, childGame]) {
    for (const a of args || []) {
      const key = typeof a === 'string' ? a.split(/[= ]/)[0] : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(a);
    }
  }
  return out;
}

// Une una version.json con ademas su base (inheritsFrom) como una versión
// standalone: completa downloads.client, assets, arguments, javaVersion y
// libraries con lo que la base aporta.
function resolveInheritance(child, base, versionId) {
  const dedupeLibraries = require('./libraries').dedupeLibraries;

  return {
    ...child,
    // Cliente: el del hijo si lo define; si no, el de la base vanilla.
    downloads: {
      ...(base.downloads || {}),
      ...(child.downloads || {})
    },
    // Asegura mainClass (el de Forge/NeoForge vive en los json del loader).
    mainClass: child.mainClass || base.mainClass || 'net.minecraft.client.main.Main',
    arguments: {
      ...(child.arguments || (base.arguments || {})),
      jvm: mergeJvmArgs(
        child.arguments && child.arguments.jvm,
        base.arguments && base.arguments.jvm
      ),
      game: mergeGameArgs(
        child.arguments && child.arguments.game,
        base.arguments && base.arguments.game
      )
    },
    assetIndex: child.assetIndex || base.assetIndex || undefined,
    assets: child.assets || base.assets || undefined,
    javaVersion: child.javaVersion || base.javaVersion || undefined,
    minimumLauncherVersion: child.minimumLauncherVersion || base.minimumLauncherVersion,
    // Libraries del loader + las vanilla que no repite.
    libraries: dedupeLibraries([child.libraries || [], base.libraries || []]),
    '_baseId': versionId
  };
}

// Invalida las cachés (útil para forzar refresco).
function clearManifestCache() {
  manifestCache = null;
  detailsCache.clear();
}

module.exports = {
  getVersionManifest,
  getVersions,
  getLatest,
  getVersionDetails,
  getInstalledVersions,
  listInstalledLocalVersions,
  removeInstalledVersion,
  loadLocalVersion,
  clearManifestCache,
  mergeJvmArgs,
  mergeGameArgs
};
