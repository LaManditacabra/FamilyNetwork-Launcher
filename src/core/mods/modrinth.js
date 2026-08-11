// src/core/mods/modrinth.js
// Integración con la API pública de Modrinth (sin API key):
// búsqueda de mods compatibles con la versión del juego, selección del .jar
// correcto y descarga/gestión de la carpeta mods del launcher.

const fs = require('fs');
const path = require('path');
const { downloadFile } = require('../minecraft/downloader');
const { ensureDir } = require('../../utils');
const { readZipEntry } = require('../../utils/zip');

const API_BASE = 'https://api.modrinth.com/v2';
const UA = 'family-launcher/0.1.0';

// Orden de preferencia al elegir un loader cuando un mod soporta varios
// (fabric primero por ser el más liviano y común; neoforge sigue a forge).
const LOADER_PRIORITY = ['fabric', 'forge', 'neoforge', 'quilt'];

// Mod ids que son el loader/platform y no requieren un jar aparte.
const PLATFORM_DEPS = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric', 'quiltloader', 'quilt',
  'forge', 'neoforge'
]);

// Dependencias que resuelve el jar completo de Fabric API.
const FABRIC_API_PROJECT = 'P7dR8mSH';

// Cache de mod id -> project id (evita pegarle a la API por cada mod).
const projectIdCache = new Map();

async function modrinthFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    if (res.status === 429) throw new Error('Modrinth está saturando: esperá unos segundos y volvé a intentar');
    throw new Error(`Modrinth respondió HTTP ${res.status}`);
  }
  return res.json();
}

// Busca proyectos tipo mod compatibles con la versión del juego (sin filtrar
// por loader: cada resultado indica en `loaders` con cuáles funciona).
// Devuelve { hits, totalHits }.
async function searchMods(query, gameVersion, { limit = 16 } = {}) {
  const facets = JSON.stringify([
    ['project_type:mod'],
    ['versions:' + gameVersion]
  ]);
  const params = new URLSearchParams({
    query: query || '',
    limit: String(limit),
    index: 'relevance',
    facets
  });
  const data = await modrinthFetch(`${API_BASE}/search?${params}`);
  return {
    hits: (data.hits || []).map((h) => ({
      id: h.project_id,
      title: h.title,
      description: h.description || '',
      author: h.author,
      downloads: h.downloads || 0,
      thumbnailUrl: h.icon_url || null,
      updatedAt: h.date_modified || null,
      tags: h.display_categories || h.categories || [],
      loaders: (h.categories || []).filter((c) => LOADER_PRIORITY.includes(c)),
      game_versions: h.versions || []
    })),
    totalHits: data.total_hits || 0
  };
}

// Elige la versión compatible: prefiere el loader ya instalado (prefLoader);
// si no, la versión cuyo loader tenga más prioridad en LOADER_PRIORITY
// (fabric >> forge >> neoforge >> quilt). El orden original (más reciente
// primero) rompe empates.
function pickVersion(compatible, prefLoader) {
  if (prefLoader) {
    const match = compatible.find((v) => (v.loaders || []).includes(prefLoader));
    if (match) return match;
  }
  const scored = compatible
    .map((v) => {
      const weights = (v.loaders || [])
        .filter((l) => LOADER_PRIORITY.includes(l))
        .map((l) => LOADER_PRIORITY.indexOf(l));
      return { v, score: weights.length ? Math.min(...weights) : Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.score - b.score);
  return scored[0].v;
}

// Resuelve el .jar a instalar para el proyecto: prefiere el loader ya
// instalado (prefLoader) cuando hay versión; si no, prioriza el loader por
// LOADER_PRIORITY entre las versiones compatibles.
async function resolveModVersion(projectId, gameVersion, prefLoader) {
  const versions = await modrinthFetch(`${API_BASE}/project/${projectId}/version`);
  const compatible = (versions || []).filter(
    (v) =>
      (v.game_versions || []).includes(gameVersion) &&
      (v.files || []).length > 0
  );
  if (!compatible.length) return null;

  const picked = pickVersion(compatible, prefLoader);

  const file = picked.files.find((f) => f.primary) || picked.files[0];
  const loaders = (picked.loaders || []).filter((l) => LOADER_PRIORITY.includes(l));
  const loader = LOADER_PRIORITY.find((l) => loaders.includes(l)) || loaders[0] || 'vanilla';
  return {
    projectId,
    id: picked.id,
    versionNumber: picked.version_number,
    filename: file.filename,
    url: file.url,
    sha1: file.hashes && file.hashes.sha1,
    size: file.size,
    gameVersion,
    loader,
    loaders,
    dependencies: (picked.dependencies || [])
      .filter((d) => d.project_id && d.dependency_type !== 'embedded')
      .map((d) => ({ projectId: d.project_id, type: d.dependency_type }))
  };
}

// Resuelve el árbol de dependencias requeridas de un mod: devuelve los archivos
// a instalar en orden (mod principal primero, luego sus dependencias required,
// transitivamente) y los proyectos que no pudieron resolverse para la versión.
// `ctx` evita ciclos y duplica el trabajo para un mismo proyecto.
async function resolveModTree(projectId, gameVersion, prefLoader, ctx = {}) {
  const seen = ctx.seen || (ctx.seen = new Set());
  if (seen.has(projectId)) return { files: [], missing: [] };
  seen.add(projectId);

  const info = await resolveModVersion(projectId, gameVersion, prefLoader);
  if (!info) return { files: [], missing: [projectId] };

  let files = [info];
  let missing = [];
  for (const dep of info.dependencies || []) {
    if (dep.type !== 'required') continue;
    const r = await resolveModTree(dep.projectId, gameVersion, info.loader, ctx);
    files = files.concat(r.files);
    missing = missing.concat(r.missing);
  }
  return { files, missing };
}

// Elige el primer archivo servible (loader, versión de juego exacta, .jar).
async function resolveModFile(projectId, gameVersion, loader = 'fabric') {
  const r = await resolveModVersion(projectId, gameVersion, loader);
  if (!r) return null;
  if (r.loader !== loader && !(r.loaders || []).includes(loader)) return null;
  return r;
}

// Devuelve el project id de Modrinth para un mod id declarado como
// dependencia. Primero intenta el slug real (cubre fabric-language-kotlin,
// cobblemon, cobbledollars, etc.); como fallback, los módulos de Fabric API
// ("fabric-*") no publicados como proyecto propio se satisfacen con el jar
// completo de Fabric API.
async function depToProjectId(depId, loader) {
  if (projectIdCache.has(depId)) return projectIdCache.get(depId);
  let projectId = null;
  try {
    const p = await modrinthFetch(`${API_BASE}/project/${encodeURIComponent(depId)}`);
    if (p && p.project_type === 'mod') projectId = p.id;
  } catch { projectId = null; }
  if (!projectId && loader === 'fabric' && depId.startsWith('fabric-')) {
    projectId = FABRIC_API_PROJECT;
  }
  projectIdCache.set(depId, projectId);
  return projectId;
}

function parseFabricDepends(jarPath, ids) {
  const raw = readZipEntry(jarPath, 'fabric.mod.json');
  if (!raw) return;
  try {
    const json = JSON.parse(raw.toString('utf8'));
    for (const id of Object.keys(json.depends || {})) {
      if (!PLATFORM_DEPS.has(id)) ids.add(id);
    }
  } catch { /* jar sin fabric.mod.json válido */ }
}

function parseQuiltDepends(jarPath, ids) {
  const raw = readZipEntry(jarPath, 'quilt.mod.json');
  if (!raw) return;
  try {
    const json = JSON.parse(raw.toString('utf8'));
    for (const dep of (json.quilt_loader && json.quilt_loader.depends) || []) {
      const id = typeof dep === 'string' ? dep : dep.id;
      if (id && !PLATFORM_DEPS.has(id)) ids.add(id);
    }
  } catch { /* jar sin quilt.mod.json válido */ }
}

// Interpreta un neoforge.mods.toml / mods.toml y devuelve los ids de las
// dependencias REQUERIDAS. Ojo: el id en "[[dependencies.X]]" es el owner (el
// mod que declara, normalmente su propio modid); la dependencia real es el
// "modId"/"modid" dentro del bloque. Soporta "type = required/optional"
// (NeoForge) y "mandatory = true/false" (Forge viejo).
function parseForgeTomlDeps(txt) {
  const ids = new Set();
  const re = /\[\[dependencies\.([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(txt))) {
    const blockStart = m.index + m[0].length;
    const next = txt.indexOf('[[', blockStart);
    const block = txt.slice(blockStart, next === -1 ? txt.length : next);
    const depId = /mod[Ii]d\s*=\s*"([^"]+)"/.exec(block);
    if (!depId) continue;
    const id = depId[1].trim();
    if (PLATFORM_DEPS.has(id)) continue;
    const type = /\btype\s*=\s*"(required|optional)"/.exec(block);
    const mandatory = /\bmandatory\s*=\s*(true|false)/.exec(block);
    const required = type
      ? type[1] === 'required'
      : (mandatory ? mandatory[1] === 'true' : false);
    if (required) ids.add(id);
  }
  return [...ids];
}

function parseForgeModsToml(jarPath, ids) {
  const raw = readZipEntry(jarPath, 'META-INF/neoforge.mods.toml') ||
    readZipEntry(jarPath, 'META-INF/mods.toml');
  if (!raw) return;
  for (const id of parseForgeTomlDeps(raw.toString('utf8'))) ids.add(id);
}

// Lee el jar instalado y devuelve los ids de mods que declara como
// dependencias requeridas (sin contar el loader ni la plataforma).
function requiredModIdsFromJar(jarPath, loader) {
  const ids = new Set();
  try {
    parseFabricDepends(jarPath, ids);
    if (loader === 'quilt') parseQuiltDepends(jarPath, ids);
    if (loader === 'forge' || loader === 'neoforge') parseForgeModsToml(jarPath, ids);
  } catch { /* jar ilegible: no se pueden leer deps */ }
  return [...ids];
}

// Compara dos versiones de Minecraft (1.21.1 < 1.21.3) numéricamente.
function mcTokenCmp(a, b) {
  const pa = String(a).replace(/[^0-9.]/g, '').split('.').map(Number);
  const pb = String(b).replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ¿Cumple gameVersion la restricción de Minecraft del mod (depends.minecraft)?
// Soporta "1.21.1", "1.21.x", ">=1.21", ">=1.19 <1.22", "[1.21,)", arrays y "||".
function minecraftRangeMatches(dep, gameVersion) {
  if (dep == null) return true;
  if (Array.isArray(dep)) return dep.some((d) => minecraftRangeMatches(d, gameVersion));
  let s = String(dep).trim();
  if (!s || s === '*' || s === 'x' || /^[xX]+$/.test(s)) return true;
  if (s.includes('||')) return s.split('||').some((d) => minecraftRangeMatches(d, gameVersion));

  const rm = /^([\[(])\s*([^,)\]]*)\s*,\s*([^)\]]*)\s*([\])])$/.exec(s);
  if (rm) {
    const lo = rm[2].trim();
    const hi = rm[3].trim();
    const loOk = !lo || (rm[1] === '[' ? mcTokenCmp(gameVersion, lo) >= 0 : mcTokenCmp(gameVersion, lo) > 0);
    const hiOk = !hi || (rm[4] === ']' ? mcTokenCmp(gameVersion, hi) <= 0 : mcTokenCmp(gameVersion, hi) < 0);
    return loOk && hiOk;
  }

  const ops = [...s.matchAll(/(>=|<=|>|<|=)\s*([0-9][0-9.]*)/g)];
  if (ops.length >= 2) {
    return ops.every((o) => {
      const c = mcTokenCmp(gameVersion, o[2]);
      return o[1] === '>=' ? c >= 0 : o[1] === '>' ? c > 0 : o[1] === '<=' ? c <= 0 : o[1] === '<' ? c < 0 : c === 0;
    });
  }

  const m = /^\s*(>=|<=|>|<|=|~|\^)?\s*([0-9][0-9.xX]*)/.exec(s);
  if (m) {
    const op = m[1] || '=';
    const ver = m[2];
    if (/[xX]/.test(ver)) {
      const vars = ver.split(/[.xX*]/).filter(Boolean).map(Number);
      const gv = gameVersion.split('.').map(Number);
      for (let i = 0; i < vars.length; i++) {
        if ((gv[i] || 0) !== vars[i]) return false;
      }
      return true;
    }
    const c = mcTokenCmp(gameVersion, ver);
    if (op === '>=') return c >= 0;
    if (op === '>') return c > 0;
    if (op === '<=') return c <= 0;
    if (op === '<') return c < 0;
    if (op === '~' || op === '^') return c >= 0;
    return c === 0;
  }
  return true;
}

// ¿El jar instalado acepta esta versión de Minecraft (fabric/quilt)?
function jarMinecraftCompatible(jarPath, gameVersion) {
  const fRaw = readZipEntry(jarPath, 'fabric.mod.json');
  if (fRaw) {
    try {
      const j = JSON.parse(fRaw.toString('utf8'));
      if (!minecraftRangeMatches(j.depends && j.depends.minecraft, gameVersion)) return false;
    } catch { /* ilegible */ }
  }
  const qRaw = readZipEntry(jarPath, 'quilt.mod.json');
  if (qRaw) {
    try {
      const j = JSON.parse(qRaw.toString('utf8'));
      for (const d of (j.quilt_loader && j.quilt_loader.depends) || []) {
        if ((typeof d === 'string' ? d : d && d.id) === 'minecraft' && d && typeof d === 'object') {
          if (!minecraftRangeMatches(d.versions, gameVersion)) return false;
        }
      }
    } catch { /* ilegible */ }
  }
  return true;
}

const projectTitleCache = new Map();

// Nombre legible de un proyecto (best effort; si no, devuelve el id).
async function projectTitle(idOrSlug) {
  if (projectTitleCache.has(idOrSlug)) return projectTitleCache.get(idOrSlug);
  let title = idOrSlug;
  try {
    const p = await modrinthFetch(`${API_BASE}/project/${encodeURIComponent(idOrSlug)}`);
    if (p && p.title) title = p.title;
  } catch { /* offline/404 */ }
  projectTitleCache.set(idOrSlug, title);
  return title;
}

function modsDirOf(gameDir) {
  return path.join(gameDir, 'mods');
}

// Descarga el .jar del mod a la carpeta mods (no vuelve a bajar los repetidos).
async function installMod(file, gameDir, onProgress = null) {
  const dir = modsDirOf(gameDir);
  ensureDir(dir);
  const dest = path.join(dir, file.filename);
  await downloadFile(file.url, dest, {
    expectedSha1: file.sha1,
    onProgress: onProgress ? (c, t) => onProgress({ phase: 'mods', current: c, total: t }) : null
  });
  return { filename: file.filename, dest };
}

// Lista los .jar que hay en la carpeta mods.
function listInstalledMods(gameDir) {
  const dir = modsDirOf(gameDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.jar'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { filename: f, size: st.size, modified: st.mtimeMs };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

function removeMod(filename, gameDir) {
  const target = path.join(modsDirOf(gameDir), filename);
  if (!filename || !target.startsWith(path.join(modsDirOf(gameDir)))) {
    throw new Error('Nombre de mod inválido');
  }
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
}

module.exports = {
  searchMods, resolveModFile, resolveModVersion, resolveModTree,
  installMod, listInstalledMods, removeMod, modsDirOf,
  requiredModIdsFromJar, depToProjectId, jarMinecraftCompatible,
  minecraftRangeMatches, projectTitle, parseForgeTomlDeps
};