// Regresión: gestión de versiones instaladas. Las vanilla solo dejan el jar
// del cliente (sin json) y deben figurar; carpetas sin json ni jar se ignoran.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  listInstalledLocalVersions,
  removeInstalledVersion
} = require('../src/core/minecraft/manifest');

function makeGameDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-versions-'));
  const versions = path.join(dir, 'versions');
  fs.mkdirSync(versions, { recursive: true });
  return { dir, versions };
}

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

test('lista vanilla (solo jar) y loaders (json), ignora carpetas sin datos', () => {
  const { dir, versions } = makeGameDir();
  write(path.join(versions, '1.21.1', '1.21.1.jar'), 'x'); // vanilla
  write(path.join(versions, '1.21.1-fabric-0.19.3', '1.21.1-fabric-0.19.3.json'),
    JSON.stringify({ id: '1.21.1-fabric-0.19.3' })); // loader
  fs.mkdirSync(path.join(versions, 'carpeta-suelta')); // sin datos

  const list = listInstalledLocalVersions(dir);
  const ids = list.map((v) => v.id).sort();
  assert.deepStrictEqual(ids, ['1.21.1', '1.21.1-fabric-0.19.3']);
  const vanilla = list.find((v) => v.id === '1.21.1');
  assert.strictEqual(vanilla.type, 'release');
  assert.ok(vanilla.sizeBytes > 0, 'debe reportar tamaño');
  const fab = list.find((v) => v.id === '1.21.1-fabric-0.19.3');
  assert.strictEqual(fab.type, 'fabric');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('removeInstalledVersion borra la carpeta y avisa si no existe', () => {
  const { dir, versions } = makeGameDir();
  write(path.join(versions, '1.20.4', '1.20.4.jar'), 'x');
  assert.strictEqual(removeInstalledVersion(dir, '1.20.4'), true);
  assert.strictEqual(fs.existsSync(path.join(versions, '1.20.4')), false);
  assert.strictEqual(removeInstalledVersion(dir, '1.20.4'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lista vacía si no hay carpeta de versiones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-empty-'));
  assert.deepStrictEqual(listInstalledLocalVersions(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
