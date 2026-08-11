// src/utils/zip.js
// Extractor ZIP mínimo y multiplataforma usando zlib (sin dependencias).
// Soporta métodos 0 (store) y 8 (deflate). Suficiente para los natives de MC.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function readUInt32LE(buf, off) {
  return buf.readUInt32LE(off);
}

// Extrae un archivo .zip en destDir.
function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  if (readUInt32LE(buf, buf.length - 22) !== 0x06054b50) {
    // No es un ZIP válido (End Of Central Directory).
    throw new Error(`Archivo no es un ZIP válido: ${zipPath}`);
  }

  // Busca el inicio del Central Directory.
  let eocd = buf.length - 22;
  while (eocd >= 0 && readUInt32LE(buf, eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('No se encontró el Central Directory del ZIP');

  const cdOffset = readUInt32LE(buf, eocd + 16);
  const cdCount = readUInt32LE(buf, eocd + 10);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (readUInt32LE(buf, pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = readUInt32LE(buf, pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = readUInt32LE(buf, pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directorio

    // Lee el Local File Header para los datos comprimidos.
    const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);

    const outPath = path.join(destDir, name);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (method === 0) {
      fs.writeFileSync(outPath, compData);
    } else if (method === 8) {
      fs.writeFileSync(outPath, zlib.inflateRawSync(compData));
    } else {
      throw new Error(`Método ZIP no soportado (${method}) en ${name}`);
    }
  }
}

// Devuelve true si el zip contiene la entrada con el nombre dado.
function zipContainsEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return false;
  const cdCount = buf.readUInt32LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(pos + 28);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    if (name === entryName) return true;
    pos += 46 + nameLen + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return false;
}

// Devuelve el contenido (sin comprimir) de una entrada del zip, o null si no
// existe. Útil para leer manifestos de los jars de mods.
function readZipEntry(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return null;
  const cdCount = buf.readUInt32LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (name !== entryName) continue;
    const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const compData = buf.subarray(dataStart, dataStart + compSize);
    return method === 0 ? compData : zlib.inflateRawSync(compData);
  }
  return null;
}

module.exports = { extractZip, zipContainsEntry, readZipEntry };
