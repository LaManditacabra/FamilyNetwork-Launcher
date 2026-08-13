// Regresión: la carpeta de datos (config, perfiles, cuenta) debe poder
// re-ubicarse con setDataRoot (app empaquetado -> userData). Si queda fija en
// data/ del proyecto resuelve dentro del app.asar de solo lectura y las
// escrituras tiran ENOTDIR.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { setDataRoot, getDataRoot } = require('../src/utils');
const store = require('../src/core/config/store');

test('data root: por defecto apunta a data/ del proyecto', () => {
  assert.ok(getDataRoot().endsWith(path.sep + 'data'), getDataRoot());
});

test('setDataRoot re-ubica archivos de config fuera del asar', () => {
  const old = getDataRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'famlaunch-'));
  try {
    setDataRoot(tmp);
    assert.strictEqual(store.dataDir(), tmp);
    assert.ok(store.configFile().startsWith(tmp));
    assert.ok(store.profilesFile().startsWith(tmp));

    // Escribir y releer en el nuevo destino (lo que tiraba ENOTDIR empaquetado).
    store.saveJson(store.profilesFile(), [{ id: 'p_1', name: 'Test' }]);
    const back = store.loadJson(store.profilesFile(), []);
    assert.strictEqual(back[0].name, 'Test');
  } finally {
    setDataRoot(old);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});