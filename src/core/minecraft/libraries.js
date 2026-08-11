// src/core/minecraft/libraries.js
// Resuelve, descarga y extrae las libraries de Minecraft según el SO.

const path = require('path');
const { LIBRARIES_BASE, DIRS } = require('./constants');
const { downloadFile } = require('./downloader');
const { ensureDir, resolvePath } = require('../../utils');
const { extractZip } = require('../../utils/zip');

// Nombre de SO que usa Minecraft en sus reglas.
function currentOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  if (process.platform === 'linux') return 'linux';
  return process.platform;
}

// Arquitectura que usa Minecraft en sus reglas (a veces).
function currentArch() {
  const a = process.arch;
  if (a === 'ia32') return 'x86';
  if (a === 'x64') return 'x64';
  if (a === 'arm64') return 'arm64';
  return a;
}

// Evalúa las "rules" de una library para saber si aplica a este SO.
function isAllowed(rules) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) {
      matches = rule.os.name === currentOs();
      if (matches && rule.os.arch && rule.os.arch !== currentArch()) {
        matches = false;
      }
    }
    if (rule.action === 'allow' && matches) allowed = true;
    if (rule.action === 'disallow' && matches) allowed = false;
  }
  return allowed;
}

// Convierte "group:artifact:version" en la ruta maven del jar.
// Devuelve SIEMPRE separadores "/" (posix) para poder usarla en URLs.
function mavenArtifactPath(name) {
  const parts = name.split(':');
  const [group, artifact, version] = parts;
  const groupPath = group.replace(/\./g, '/');
  return `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;
}

// Compara dos versiones de maven segmento a segmento (9.10.1 > 9.3).
function versionCmp(a, b) {
  const pa = String(a).split(/[.+\-_]/);
  const pb = String(b).split(/[.+\-_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (pa[i] === pb[i]) continue;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isInteger(na) && Number.isInteger(nb)) return na > nb ? 1 : -1;
    return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

// Deduplica libraries por grupo:artefacto:clasificador, quedándose con la
// versión MÁS ALTA del segmento de versión (3er campo). Evita clases ASM
// duplicadas (vanilla trae asm-9.x y el loader Fabric otra) que el verificador
// de classpath de Fabric rechaza. El clasificador (4to+ campo, p. ej.
// "natives-windows") NO se compara ni colapsa: `lwjgl:3.3.3` (jar principal) y
// `lwjgl:3.3.3:natives-windows` son artefactos distintos que deben convivir.
function dedupeLibraries(arrays) {
  const order = [];
  const byKey = new Map();
  for (const libs of arrays || []) {
    for (const lib of libs || []) {
      if (!lib || !lib.name) continue;
      const parts = lib.name.split(':');
      const version = parts[2] || '';
      const key = parts[0] + ':' + parts[1] + ':' + parts.slice(3).join(':');
      const cur = byKey.get(key);
      if (!cur) {
        byKey.set(key, lib);
        order.push(key);
      } else if (versionCmp(version, cur.name.split(':')[2] || '') > 0) {
        byKey.set(key, lib);
      }
    }
  }
  return order.map((k) => byKey.get(k));
}

// Calcula las rutas de cada library (classpath) y los natives a extraer.
function resolveLibraryPaths(versionDetails, gameDir) {
  const classPath = [];
  const natives = [];
  const libsDir = path.join(gameDir, DIRS.libraries);
  const os = currentOs();

  for (const lib of dedupeLibraries([versionDetails.libraries || []])) {
    if (!isAllowed(lib.rules)) continue;

    // Library principal (artifact).
    const artifact = lib.downloads && lib.downloads.artifact;
    if (artifact) {
      const jarRel = artifact.path;
      const jarAbs = path.join(libsDir, jarRel);
      classPath.push(jarAbs);
    } else if (!lib.downloads) {
      // Sin downloads: versiones viejas, armamos la URL maven nosotros.
      const jarRel = mavenArtifactPath(lib.name);
      const jarAbs = path.join(libsDir, jarRel);
      classPath.push(jarAbs);
    }
    // Si hay downloads pero sin artifact => natives-only: ese jar base no
    // existe, no va al classpath (pero sus natives sí se gestionan abajo).

    // Natives (solo para el SO actual).
    if (lib.natives && lib.natives[os]) {
      const classifier = lib.natives[os];
      const nativeEntry =
        lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier];
      if (nativeEntry) {
        natives.push({
          jarRel: nativeEntry.path,
          url: nativeEntry.url,
          sha1: nativeEntry.sha1,
          jarAbs: path.join(libsDir, nativeEntry.path),
          extractDir: path.join(gameDir, DIRS.versions, versionDetails.id, 'natives')
        });
      }
    }
  }

  return { classPath, natives };
}

// Descarga las libraries y extrae los natives.
// onProgress(descargado, total) opcional.
async function downloadLibraries(versionDetails, gameDir, onProgress = null) {
  const { classPath, natives } = resolveLibraryPaths(versionDetails, gameDir);

  for (const jarAbs of classPath) {
    // Para artifact con url conocida usamos la url; si no, asumimos maven.
    // Resolvemos de nuevo la url usada en resolveLibraryPaths sería ideal,
    // pero reusamos el nombre: descargamos vía LIBRARIES_BASE si hace falta.
    // (Optimización: descargar solo las que faltan.)
    void jarAbs;
  }

  // Descargamos todas las jars (classpath) y los natives.
  const allJars = collectJarDownloads(versionDetails, gameDir);
  let done = 0;
  const total = allJars.length + natives.length;
  for (const j of allJars) {
    await downloadFile(j.url, j.dest, { expectedSha1: j.sha1, onProgress: () => {} });
    done++;
    if (onProgress) onProgress(done, total);
  }
  for (const n of natives) {
    ensureDir(n.extractDir);
    await downloadFile(n.url, n.jarAbs, { expectedSha1: n.sha1, onProgress: () => {} });
    extractZip(n.jarAbs, n.extractDir);
    done++;
    if (onProgress) onProgress(done, total);
  }

  return { classPath, natives };
}

// Reune las descargas de todas las jars (artifact con url, o maven fallback).
function collectJarDownloads(versionDetails, gameDir) {
  const out = [];
  const libsDir = path.join(gameDir, DIRS.libraries);
  for (const lib of dedupeLibraries([versionDetails.libraries || []])) {
    if (!isAllowed(lib.rules)) continue;
    const artifact = lib.downloads && lib.downloads.artifact;
    if (artifact) {
      out.push({ url: artifact.url, dest: path.join(libsDir, artifact.path), sha1: artifact.sha1 });
    } else if (!lib.downloads) {
      // Sin downloads: versiones viejas, armamos la URL maven base nosotros.
      const rel = mavenArtifactPath(lib.name);
      out.push({ url: LIBRARIES_BASE + rel, dest: path.join(libsDir, rel), sha1: null });
    }
    // Si hay downloads pero sin artifact => es natives-only, lo maneja `natives`.
  }
  return out;
}

module.exports = { resolveLibraryPaths, downloadLibraries, isAllowed, currentOs, currentArch, mavenArtifactPath, dedupeLibraries, versionCmp };
