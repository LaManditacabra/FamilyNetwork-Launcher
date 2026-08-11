// Regresión: dedupeLibraries. El clasificador (p. ej. "natives-windows") NO es
// parte de la versión: "lwjgl:3.3.3" (jar principal) y "lwjgl:3.3.3:natives-x"
// son artefactos distintos y deben convivir; el ASM duplicado sí se colapsa.
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupeLibraries } = require('../src/core/minecraft/libraries');

const L = (name) => ({ name, downloads: {} });

test('mantiene el jar principal y los natives del mismo artefacto (bug LWJGL)', () => {
  const out = dedupeLibraries([[L('org.lwjgl:lwjgl:3.3.3'),
    L('org.lwjgl:lwjgl:3.3.3:natives-windows'),
    L('org.lwjgl:lwjgl:3.3.3:natives-windows-x86'),
    L('org.lwjgl:lwjgl:3.3.3:natives-linux')]]);
  const names = out.map((l) => l.name);
  assert.ok(names.includes('org.lwjgl:lwjgl:3.3.3'), 'el jar principal debe seguir');
  assert.ok(names.includes('org.lwjgl:lwjgl:3.3.3:natives-linux'), 'natives-linux debe seguir');
  assert.ok(names.includes('org.lwjgl:lwjgl:3.3.3:natives-windows'), 'natives-windows debe seguir');
});

test('colapsa versiones del mismo artefacto sin clasificador quedándose con la mayor', () => {
  const out = dedupeLibraries([[L('org.ow2.asm:asm:9.3'), L('org.ow2.asm:asm:9.10.1')]]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'org.ow2.asm:asm:9.10.1');
});

test('dedupe por clasificador no mezcla natives de artefactos distintos', () => {
  const out = dedupeLibraries([[L('org.lwjgl:lwjgl-glfw:3.3.3:natives-linux'),
    L('org.lwjgl:lwjgl-glfw:3.3.3:natives-windows')]]);
  assert.strictEqual(out.length, 2);
});

test('empate de versión respeta el primero (mantiene el jar principal listado antes)', () => {
  const out = dedupeLibraries([[L('org.lwjgl:lwjgl:3.3.3'),
    L('org.lwjgl:lwjgl:3.3.3:natives-windows')]]);
  assert.strictEqual(out[0].name, 'org.lwjgl:lwjgl:3.3.3');
});
