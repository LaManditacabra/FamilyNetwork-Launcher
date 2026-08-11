// src/core/minecraft/downloader.js
// Descarga archivos de forma TOLERANTE a redes inestables:
// - Baja a un archivo temporal `.part` (nunca pisa el destino final con basura).
// - Verifica el SHA1 del contenido descargado.
// - Reintenta con backoff hasta obtener una copia íntegra.
// - Solo se renombra el `.part` a destPath cuando el hash coincide.
// - Si ya existe un destPath válido, se omite (skip).

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ensureDir } = require('../../utils');

// API de red de NODE (no Chromium/Electron): evita MITM/proxy del SO que
// corrompía las descargas vía fetch. Agent propio, sin proxies del sistema.
const AGENT = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: true,
  timeout: 30000,
});
const HTTP_AGENT = new http.Agent({ keepAlive: true, timeout: 30000 });

// Máxima cantidad de intentos por archivo y espera base entre reintentos.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 800;

// Calcula el SHA1 de un archivo existente (null si no existe).
function fileSha1(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = require('crypto').createHash('sha1');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

// Baja el body de `url` (siguiendo redirects hasta 5) y lo escribe en destPath.
// Si el hash no coincide o la descarga queda incompleta, borra el archivo y
// lanza Error. Devuelve la cantidad de bytes descargados.
async function streamOnce(url, destPath, expectedSha1, onProgress) {
  let currentUrl = url;
  let downloaded = 0;

  for (let redirects = 0; redirects <= 5; redirects++) {
    const isHttps = currentUrl.startsWith('https:');
    const mod = isHttps ? https : http;
    const u = new URL(currentUrl);

    const res = await new Promise((resolve, reject) => {
      const req = mod.get(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'family-launcher/0.1.0', 'Accept-Encoding': 'identity' },
          agent: isHttps ? AGENT : HTTP_AGENT,
        },
        resolve
      );
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    });

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume(); // drena
      currentUrl = new URL(res.headers.location, currentUrl).toString();
      continue; // sigue el redirect
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode} al descargar ${url}`);
    }

    const total = Number(res.headers['content-length']) || 0;
    downloaded = 0;

    const fileStream = fs.createWriteStream(destPath);
    const hash = expectedSha1 ? require('crypto').createHash('sha1') : null;
    const nodeStream = res; // IncomingMessage ya es un stream de Node

    await new Promise((resolve, reject) => {
      nodeStream.on('data', (chunk) => {
        downloaded += chunk.length;
        if (hash) hash.update(chunk);
        if (onProgress) onProgress(downloaded, total);
      });
      nodeStream.on('error', reject);
      fileStream.on('error', reject);
      fileStream.on('finish', resolve);
      nodeStream.pipe(fileStream);
      res.once('aborted', () => reject(new Error('conexión abortada por el servidor'))); // safety
    });

    // Content-length fue anunciado pero llegó menos: conexión cortada.
    if (total > 0 && downloaded !== total) {
      fs.unlinkSync(destPath);
      throw new Error(
        `Descarga incompleta para ${path.basename(destPath)} (${downloaded}/${total} bytes)`
      );
    }

    if (hash) {
      const actual = hash.digest('hex');
      if (actual !== expectedSha1) {
        fs.unlinkSync(destPath);
        throw new Error(
          `Hash incorrecto (stream). esperado=${expectedSha1}, stream=${actual}`
        );
      }
    }

    // Doble chequeo: lo que quedó en disco debe dar el MISMO hash que el stream.
    if (hash) {
      const onDisk = fileSha1(destPath);
      if (onDisk !== expectedSha1) {
        fs.unlinkSync(destPath);
        throw new Error(
          `Hash incorrecto (disco vs esperado). esperado=${expectedSha1}, disco=${onDisk}`
        );
      }
    }

    // Se pudo exportar el body; devolvemos.
    return downloaded;
  }

  throw new Error(`Demasiados redirects al descargar ${url}`);
}

// Descarga un archivo y lo guarda en destPath con reintentos y verificación.
// Opciones:
//   expectedSha1: string -> valida el hash; si falla, reintenta hasta obtener
//                          una copia íntegra (solución a conexiones que
//                          corrompen la descarga a mitad de camino).
//   onProgress:   (downloaded, total) => void  (llama por chunk, mientras dura).
// Devuelve true si ya existía y era válido (skip), o false si se descargó bien.
async function downloadFile(url, destPath, { expectedSha1 = null, onProgress = null } = {}) {
  ensureDir(path.dirname(destPath));

  // Archivos de 0 bytes (fallidos) se descartan para reintentar.
  if (fs.existsSync(destPath) && fs.statSync(destPath).size === 0) {
    fs.unlinkSync(destPath);
  }

  // Si ya existe el archivo con el hash correcto, no lo volvemos a descargar.
  if (expectedSha1 && fileSha1(destPath) === expectedSha1) {
    return true; // skip
  }

  // Descarga a un archivo .part para no dejar el destino a medio escribir.
  const part = destPath + '.part';
  if (fs.existsSync(part)) fs.unlinkSync(part);

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await streamOnce(url, part, expectedSha1, onProgress);
      // Éxito: mover a destino (renombre atómico).
      fs.renameSync(part, destPath);
      return false; // se descargó (no skip)
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `[descarga] reintento ${attempt}/${MAX_ATTEMPTS} para ${path.basename(destPath)}: ${err.message}`
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw new Error(
    `No se pudo descargar ${path.basename(destPath)} de forma integra tras ${MAX_ATTEMPTS} intentos ` +
    `(red inestable): ${lastError ? lastError.message : 'desconocido'}`
  );
}

module.exports = { downloadFile, fileSha1 };