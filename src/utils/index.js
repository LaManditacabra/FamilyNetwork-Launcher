// src/utils/index.js
// Funciones auxiliares compartidas por los módulos de core.
// (Se implementarán según se necesiten.)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Carpeta de datos del launcher (config.json, perfiles, cuenta).
// En dev/tests es data/ del proyecto; en la app empaquetada el proceso
// principal la apunta a app.getPath('userData') porque el app.asar es de solo
// lectura (escribir adentro tira ENOTDIR: not a directory).
let dataRoot = path.resolve(__dirname, '..', '..', 'data');
function setDataRoot(dir) {
  if (dir) dataRoot = path.resolve(dir);
}
function getDataRoot() {
  return dataRoot;
}

function resolvePath(p) {
  // Expande variables como %APPDATA% en Windows y normaliza separadores.
  let resolved = p;
  if (process.platform === 'win32' && p.includes('%APPDATA%')) {
    resolved = p.replace('%APPDATA%', process.env.APPDATA);
  }
  return path.normalize(path.resolve(resolved));
}

// UUID offline determinístico de Java (igual que el backend Yggdrasil):
// md5("OfflinePlayer:"+name) con bits de version/variant fijados.
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const b = h.toString('hex');
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}

module.exports = { ensureDir, resolvePath, offlineUuid, setDataRoot, getDataRoot };
