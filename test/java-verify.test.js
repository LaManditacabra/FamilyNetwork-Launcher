// Regresión: verificación del binario de JRE descargado (networks corruptas
// entregan archivos rotos; verifyJavaBinary debe detectarlos y devolver 0).
const { test } = require('node:test');
const assert = require('node:assert');
const { verifyJavaBinary } = require('../src/core/java');

test('verifyJavaBinary: un archivo que no es java devuelve 0 (corrupto)', async () => {
  const r = await verifyJavaBinary('/etc/hostname');
  assert.strictEqual(r, 0, 'texto plano no es un java ejecutable');
});

test('verifyJavaBinary: un binario inexistente devuelve 0 (no explota)', async () => {
  const r = await verifyJavaBinary('/no/existe/java.exe');
  assert.strictEqual(r, 0);
});