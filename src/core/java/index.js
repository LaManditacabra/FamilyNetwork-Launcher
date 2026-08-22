// src/core/java/index.js
// Gestión del runtime de Java para ejecutar Minecraft.
// - Detecta Java en el PATH y en ubicaciones comunes.
// - Si no hay uno compatible, descarga un JRE (Adoptium/Temurin).

const { exec, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('../minecraft/downloader');
const { extractZip } = require('../../utils/zip');
const { ensureDir } = require('../../utils');
const os = require('os');

// Ejecuta un comando y devuelve { stdout, stderr }.
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

// Parsea la versión mayor de la salida de `java -version`.
// "1.8.0_401" -> 8 ; "17.0.10" -> 17 ; "21.0.3" -> 21.
function parseMajor(text) {
  const m = text.match(/"(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const first = parseInt(m[1], 10);
  if (first === 1 && m[2]) return parseInt(m[2], 10); // formato 1.8 -> 8
  return first;
}

// Devuelve la versión mayor de Java de un ejecutable.
async function getJavaVersion(javaPath) {
  const { stderr } = await run(`"${javaPath}" -version`);
  return parseMajor(stderr + '');
}

// Major mínimo requerido según la versión de Minecraft.
// 1.20.5+ requiere Java 21, y las versiones 1.20.4+ usan el flag
// --sun-misc-unsafe-memory-access=allow (solo existe en Java 24+); como el
// launcher no filtra flags por ahora, se baja 24 directo para esas versiones.
// 1.17 - 1.20.4 usan Java 17; versiones previas usan Java 8.
function requiredMajorForVersion(minecraftVersionId) {
  const m = String(minecraftVersionId).match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return 24; // versiones modernas (tipo "26.2") -> 24+
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const patch = m[3] ? parseFloat(m[3]) : 0;
  if (major === 1 && minor === 20 && patch >= 5) return 24;
  if (major === 1 && minor >= 21) return 24;
  if (major === 1 && minor >= 17) return 17;
  if (major === 1) return 8; // 1.0 - 1.16 -> Java 8
  return 24; // releases modernas sin prefijo 1.
}

// Busca Java en el PATH y en carpetas conocidas.
// Devuelve { path, major } o null.
async function findJava() {
  // 1) PATH.
  try {
    const { stderr } = await run('java -version');
    const major = parseMajor(stderr + '');
    if (major) return { path: 'java', major };
  } catch { /* no hay java en PATH */ }

  // 2) Carpetas comunes según SO.
  const candidates = [];
  if (process.platform === 'win32') {
    const bases = [
      'C:\\Program Files\\Java',
      'C:\\Program Files (x86)\\Java',
      process.env.LOCALAPPDATA + '\\Programs\\Java'
    ];
    for (const b of bases) {
      if (fs.existsSync(b)) {
        for (const d of fs.readdirSync(b)) {
          candidates.push(path.join(b, d, 'bin', 'java.exe'));
        }
      }
    }
  } else if (process.platform === 'darwin') {
    const base = '/Library/Java/JavaVirtualMachines';
    if (fs.existsSync(base)) {
      for (const d of fs.readdirSync(base)) {
        candidates.push(path.join(base, d, 'Contents', 'Home', 'bin', 'java'));
      }
    }
  } else if (process.platform === 'linux') {
    const base = '/usr/lib/jvm';
    if (fs.existsSync(base)) {
      for (const d of fs.readdirSync(base)) {
        candidates.push(path.join(base, d, 'bin', 'java'));
      }
    }
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const major = await getJavaVersion(c);
        if (major) return { path: c, major };
      } catch { /* ignorar */ }
    }
  }
  return null;
}

// Verifica que un java.exe/jar sea un binario que realmente ejecuta.
// Devuelve la versión major (número) si responde a `java -version`; 0 si no.
async function verifyJavaBinary(javaBin) {
  try {
    const { stderr } = await run(`"${javaBin}" -version`);
    const major = parseMajor((stderr || '') + '');
    return major || 0;
  } catch {
    return 0;
  }
}

// Extrae un archivo de runtime según su formato real (no confiamos en la
// extensión): Adoptium sirve .zip en Windows y .tar.gz en Linux/macOS.
// Devuelve true si logró extraer.
function extractArchive(src, destDir) {
  const head = fs.readFileSync(src, { encoding: 'latin1', flag: 'r' }).slice(0, 2);
  if (head === 'PK') {
    extractZip(src, destDir);
    return true;
  }
  if (head === '\x1f\x8b') {
    // tar.gz: lo extrae el tar del sistema (evita dependencias de npm).
    const res = spawnSync('tar', ['-xzf', src, '-C', destDir], { windowsHide: true });
    if (res.status !== 0) {
      throw new Error('No se pudo extraer el JRE (tar): ' + (res.stderr || '').toString().slice(0, 300));
    }
    return true;
  }
  return false;
}

// Descarga un JRE desde Adoptium y devuelve la ruta al ejecutable.
// Reintenta la descarga si la extracción falla (redes que corrompen streams).
async function downloadJava(major, gameDir, onProgress = null) {
  const osMap = { win32: 'windows', darwin: 'macos', linux: 'linux' };
  const platformOs = osMap[process.platform] || 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';

  const url =
    `https://api.adoptium.net/v3/binary/latest/${major}/ga/${platformOs}/${arch}` +
    `/jre/hotspot/normal/eclipse?project=jdk`;

  const runtimeDir = path.join(gameDir, 'runtime');
  ensureDir(runtimeDir);
  const extractDir = path.join(runtimeDir, `jre-${major}`);
  const destZip = path.join(runtimeDir, `jre-${major}.bin`);

  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    if (fs.existsSync(destZip)) fs.rmSync(destZip, { force: true });
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    ensureDir(extractDir);

    await downloadFile(url, destZip, {
      onProgress: onProgress ? (c, t) => onProgress({ phase: 'java', current: c, total: t }) : null
    });

    try {
      if (!extractArchive(destZip, extractDir)) {
        throw new Error('Formato de JRE de Adoptium no reconocido');
      }
      const javaBin = platformOs === 'windows'
        ? findJavaBinary(extractDir, 'java.exe')
        : findJavaBinary(extractDir, 'java');
      if (!javaBin) throw new Error('No se encontró java dentro del JRE extraído');
      // Verifica que el binario realmente ejecute (redes corruptas entregan
      // archivos rotos). Si no responde a `java -version`, se limpia y reintenta.
      const major = await verifyJavaBinary(javaBin);
      if (!major) {
        throw new Error('El JRE descargado está corrupto (java -version no responde)');
      }
      return javaBin;
    } catch (err) {
      if (attempt < MAX_TRIES) {
        console.warn(`[java] descarga o extracción fallida (${err.message}), reintento ${attempt}/${MAX_TRIES}`);
        continue;
      }
      throw new Error('No se pudo descargar un JRE de Adoptium: ' + err.message);
    }
  }
}

// Busca recursivamente bin/<nombre> dentro de extractDir.
function findJavaBinary(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findJavaBinary(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

// Asegura un Java compatible con la versión de Minecraft.
// 1) Busca uno instalado compatible. 2) Si no, descarga JRE del major requerido.
async function ensureJava(minecraftVersionId, gameDir, onProgress = null) {
  const required = requiredMajorForVersion(minecraftVersionId);

  const found = await findJava();
  if (found && found.major >= required) {
    return found.path;
  }

  // Si hay un java pero es muy viejo, igual intentamos usarlo como fallback.
  if (found) {
    console.warn(`Java ${found.major} encontrado, pero se requiere ${required}. Descargando JRE.`);
  }

  return downloadJava(required, gameDir, onProgress);
}

module.exports = {
  parseMajor,
  getJavaVersion,
  requiredMajorForVersion,
  findJava,
  downloadJava,
  ensureJava,
  verifyJavaBinary
};
