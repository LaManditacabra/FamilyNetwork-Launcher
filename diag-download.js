// Diagnóstico temporal: baja el client.jar real de Mojang y compara
// hash del stream + hash del disco + tamaño + mutación en el tiempo.
// Uso: node diag-download.js <version>  (ej: 1.20.1)
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');

const versionId = process.argv[2] || '1.20.1';

function sha1File(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

async function main() {
  const manifest = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json();
  const v = manifest.versions.find((x) => x.id === versionId);
  if (!v) throw new Error('version no encontrada: ' + versionId);
  const details = await (await fetch(v.url)).json();
  const dl = details.downloads.client;
  console.log('version:', versionId, 'url:', dl.url);
  console.log('sha1 esperado (manifest):', dl.sha1, '(', dl.size, 'bytes )');

  const dest = 'diag-' + versionId + '.jar';
  for (const attempt of [1, 2, 3]) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    const res = await fetch(dl.url, { redirect: 'follow' });
    console.log('\n--- intento', attempt, '---');
    console.log('status:', res.status, '| content-length header:', res.headers.get('content-length'));
    const total = Number(res.headers.get('content-length')) || 0;
    let downloaded = 0;
    const h = crypto.createHash('sha1');
    const fileStream = fs.createWriteStream(dest);
    await new Promise((resolve, reject) => {
      Readable.fromWeb(res.body)
        .on('data', (c) => {
          downloaded += c.length;
          h.update(c);
        })
        .on('error', reject)
        .pipe(fileStream)
        .on('finish', resolve)
        .on('error', reject);
    });
    const streamSha = h.digest('hex');
    await new Promise((r) => setTimeout(r, 250));
    const discoSha1 = sha1File(dest);
    await new Promise((r) => setTimeout(r, 1000));
    const discoSha2 = sha1File(dest);
    const size = fs.statSync(dest).size;
    console.log('bytes recibidos:', downloaded, '| size en disco:', size);
    console.log('hash stream:', streamSha);
    console.log('hash disco (t+250ms):', discoSha1);
    console.log('hash disco (t+1.25s):', discoSha2);
    console.log('content-length == bytes?:', size === total, '| stream==esperado:', streamSha === dl.sha1, '| disco==esperado:', discoSha1 === dl.sha1, '| disco1==disco2:', discoSha1 === discoSha2);
    if (streamSha === dl.sha1 && discoSha1 === dl.sha1) {
      console.log('RESULTADO: descarga OK en intento', attempt);
      fs.unlinkSync(dest);
      return;
    }
  }
  console.log('RESULTADO: sigue fallando tras 3 intentos con este detalle de arriba.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});