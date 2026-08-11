// src/core/minecraft/loaders.js
// Loaders de mods: identificación y despacho de instalación.
// - Fabric: se instala sin Java (meta.fabricmc.net → version.json completo).
// - Forge / NeoForge: ejecutan el instalador oficial con el JRE del launcher
//   (el cliente parcheado se genera en esa instalación).
// - Los ids instalados usan el patrón "<mc>-<loader>-<version>" (fabric, forge,
//   neoforge) para que el selector y el lanzamiento los reconozcan.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DIRS } = require('./constants');
const { ensureDir } = require('../../utils');
const { ensureJava } = require('../java');
const fabric = require('./fabric');

const LOADERS = ['fabric', 'forge', 'neoforge'];
const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

// Marca que le sigue al mc en el id de una versión con loader.
const LOADER_RE = /-(fabric|forge|neoforge)-\S+/;

// ¿Qué loader usa esta id instalada? (null si es vanilla).
function loaderOfId(versionId) {
  const m = String(versionId).match(LOADER_RE);
  return m ? m[1] : null;
}

function isLoaderId(versionId) {
  return loaderOfId(versionId) !== null;
}

// Versión base de Minecraft de una id con loader ("1.21.1-fabric-0.16.9" -> "1.21.1").
function gameVersionOf(versionId) {
  const idx = String(versionId).search(/-/);
  return idx === -1 ? String(versionId) : String(versionId).slice(0, idx);
}

// Valida el nombre de un loader (tolera "neo" como alias de neoforge).
function normalizeLoader(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'neo' || t === 'neoforge') return 'neoforge';
  if (LOADERS.includes(t)) return t;
  throw new Error('Loader desconocido: ' + type);
}

// ---- Versiones disponibles (maven-metadata.xml) ----

function fetchText(url) {
  return fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} al consultar ${url}`);
    return r.text();
  });
}

function versionsFromXml(xml) {
  return [...String(xml).matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

// Compara dos versiones numéricas [n1, n2, ...].
function numCmp(a, b) {
  const aa = String(a).split('.').map((x) => Number(x) || 0);
  const bb = String(b).split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const d = (aa[i] || 0) - (bb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Último Forge estable para una versión de MC: "<mc>-<build>".
async function latestForge(minecraftVersion) {
  const xml = await fetchText(`${FORGE_MAVEN}/maven-metadata.xml`);
  const versions = versionsFromXml(xml)
    .filter((v) => new RegExp(`^${escapeRegExp(minecraftVersion)}-\\d`).test(v));
  if (!versions.length) throw new Error(`Forge no publicó builds para Minecraft ${minecraftVersion}`);
  versions.sort((a, b) => numCmp(b.slice(minecraftVersion.length + 1), a.slice(minecraftVersion.length + 1)));
  return versions[0];
}

// Prefijo NeoForge de una versión de MC. Esquema viejo: "1.21.1" -> "21.1",
// "1.21" -> "21.0", "1.20.1" -> "20.1". Esquema nuevo (por año): "26.2" -> "26.2",
// "25.0" -> "25.0" (MC ya no arranca con "1.").
function neoPrefix(minecraftVersion) {
  const [maj, min, patch] = String(minecraftVersion).split('.');
  if (parseInt(maj, 10) !== 1) {
    return `${parseInt(maj, 10)}${min !== undefined ? '.' + min : '.0'}`;
  }
  return `${parseInt(min, 10)}${patch !== undefined ? '.' + patch : '.0'}`;
}

// Último NeoForge estable para una versión de MC.
async function latestNeoForge(minecraftVersion) {
  const xml = await fetchText(`${NEO_MAVEN}/maven-metadata.xml`);
  const prefix = neoPrefix(minecraftVersion);
  const all = versionsFromXml(xml).filter((v) => v.startsWith(prefix + '.'));
  const stable = all.filter((v) => !/-beta$|-pre$|^test/i.test(v));
  const pool = (stable.length ? stable : all).sort((a, b) => numCmp(b, a));
  if (!pool.length) throw new Error(`NeoForge no publicó builds para Minecraft ${minecraftVersion}`);
  return pool[0];
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Ejecución del instalador ----

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; if (opts.logStream) opts.logStream(d.toString()); });
    child.stderr.on('data', (d) => { err += d; if (opts.logStream) opts.logStream(d.toString()); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`El instalador terminó con código ${code}\n${(err + out).slice(-600)}`));
    });
  });
}

// Baja el instalador dentro del gameDir (nunca en deportes ajenos) y devuelve su ruta.
async function fetchInstaller(url, gameDir) {
  const dir = path.join(gameDir, '.installers');
  ensureDir(dir);
  const dest = path.join(dir, path.posix.basename(new URL(url).pathname));
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
    const { downloadFile, fileSha1 } = require('./downloader');
    await downloadFile(url, dest, { expectedSha1: null });
    const _ = fileSha1(dest); void _;
  }
  return dest;
}

// NeoForge instala con el id oficial "neoforge-<ver>"; lo renombramos a
// "<mc>-neoforge-<ver>" para que el selector sepa de qué Minecraft es.
function renameNeoVersionDir(gameDir, officialId, finalId) {
  const oldDir = path.join(gameDir, DIRS.versions, officialId);
  const newDir = path.join(gameDir, DIRS.versions, finalId);
  if (officialId === finalId || !fs.existsSync(oldDir)) return;
  if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true, force: true });
  fs.renameSync(oldDir, newDir);
  const oldJson = path.join(newDir, `${officialId}.json`);
  const newJson = path.join(newDir, `${finalId}.json`);
  if (fs.existsSync(oldJson)) {
    const json = JSON.parse(fs.readFileSync(oldJson, 'utf-8'));
    json.id = finalId;
    fs.writeFileSync(newJson, JSON.stringify(json, null, 2));
    fs.unlinkSync(oldJson);
  }
}

// Forge/NeoForge exigen un launcher_profiles.json (el launcher oficial lo
// crea); se asegura uno vacío para que el instalador escriba su version.json.
function ensureLauncherProfiles(gameDir) {
  const file = path.join(gameDir, 'launcher_profiles.json');
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, JSON.stringify({
    profiles: {},
    selectedProfile: '(Default)',
    clientToken: 'family-launcher',
    versionTag: 'family-launcher'
  }));
}

// Instala Forge y NeoForge ejecutando el instalador oficial con un JRE del
// launcher. El instalador escribe versions/<id>/<id>.json completo y las
// libraries en gameDir/libraries (misma estructura que las vanilla).
// onProgress({ phase: 'loader-download'|'loader-install', current, total }).
async function installForgeLike({ kind, minecraftVersion, gameDir, versionUrl, id, onProgress }) {
  const versionDir = path.join(gameDir, DIRS.versions, id);
  if (fs.existsSync(path.join(versionDir, `${id}.json`))) return id; // ya instalado

  if (onProgress) onProgress({ phase: 'loader-download', current: 0, total: 1 });
  const installer = await fetchInstaller(versionUrl, gameDir);
  if (onProgress) onProgress({ phase: 'loader-download', current: 1, total: 1 });

  const javaPath = await ensureJava(minecraftVersion, gameDir, (p) => {
    if (onProgress) onProgress(p);
  });

  ensureLauncherProfiles(gameDir);

  if (onProgress) onProgress({ phase: 'loader-install', current: 0, total: 0 });
  // --installClient escribe las versiones en <gameDir>/versions.
  await runProcess(javaPath, ['-jar', installer, '--installClient', gameDir], {
    cwd: gameDir,
    logStream: (line) => console.log('[LOADER:' + kind + ']', line.trim())
  });

  // NeoForge: adaptar el id del instalador al esquema "<mc>-neoforge-<ver>".
  if (kind === 'neoforge') {
    const officialId = path.posix.basename(new URL(versionUrl).pathname).replace(/-installer\.jar$/, '');
    renameNeoVersionDir(gameDir, officialId, id);
  }

  const finalDir = path.join(gameDir, DIRS.versions, id);
  if (!fs.existsSync(path.join(finalDir, `${id}.json`))) {
    throw new Error(`El instalador de ${kind} no dejó versions/${id}/ (¿versión soportada?)`);
  }
  return id;
}

// Forge.
async function installForge(minecraftVersion, gameDir, onProgress = null) {
  const mavenVer = await latestForge(minecraftVersion); // "1.20.1-47.4.22"
  const id = `${minecraftVersion}-forge-${mavenVer.slice(minecraftVersion.length + 1)}`; // "1.20.1-forge-47.4.22"
  const versionUrl = `${FORGE_MAVEN}/${mavenVer}/forge-${mavenVer}-installer.jar`;
  return installForgeLike({ kind: 'forge', minecraftVersion, gameDir, versionUrl, id, onProgress });
}

// NeoForge.
async function installNeoForge(minecraftVersion, gameDir, onProgress = null) {
  const neoVer = await latestNeoForge(minecraftVersion);
  const id = `${minecraftVersion}-neoforge-${neoVer}`;
  const versionUrl = `${NEO_MAVEN}/${neoVer}/neoforge-${neoVer}-installer.jar`;
  return installForgeLike({ kind: 'neoforge', minecraftVersion, gameDir, versionUrl, id, onProgress });
}

// Punto de entrada único. type: 'fabric'|'forge'|'neoforge'.
async function installLoader(type, minecraftVersion, gameDir, onProgress = null) {
  const t = normalizeLoader(type);
  if (t === 'fabric') {
    const { id } = await fabric.installFabric(minecraftVersion, gameDir, onProgress);
    return id;
  }
  if (t === 'forge') return installForge(minecraftVersion, gameDir, onProgress);
  return installNeoForge(minecraftVersion, gameDir, onProgress);
}

module.exports = {
  LOADERS,
  LOADER_LABEL,
  loaderOfId,
  isLoaderId,
  gameVersionOf,
  normalizeLoader,
  latestForge,
  latestNeoForge,
  neoPrefix,
  installLoader,
  installForge,
  installNeoForge
};