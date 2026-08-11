// Regresión: prefijo de NeoForge. "1.21.1" -> "21.1" (esquema viejo) y
// "26.2" -> "26.2" (esquema por año, cuando MC dejó de arrancar con "1.").
const { test } = require('node:test');
const assert = require('node:assert');
const { neoPrefix } = require('../src/core/minecraft/loaders');

test('neoPrefix: esquema viejo (MC 1.x)', () => {
  assert.strictEqual(neoPrefix('1.21.1'), '21.1');
  assert.strictEqual(neoPrefix('1.21.3'), '21.3');
  assert.strictEqual(neoPrefix('1.21'), '21.0');
  assert.strictEqual(neoPrefix('1.20.1'), '20.1');
});

test('neoPrefix: esquema nuevo por año (26.x, sin "1.")', () => {
  assert.strictEqual(neoPrefix('26.2'), '26.2');
  assert.strictEqual(neoPrefix('26.1'), '26.1');
  assert.strictEqual(neoPrefix('25.0'), '25.0');
});
