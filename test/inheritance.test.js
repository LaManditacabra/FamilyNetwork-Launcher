// Regresión: merge de argumentos en resolveInheritance. NeoForge/Forge dejan
// los game args vanilla (--accessToken, --version, …) en la base y solo aportan
// sus "--fml.*"; si no se fusionan, el cliente NeoForge tira
// MissingRequiredOptionsException por acceso/version.
const { test } = require('node:test');
const assert = require('node:assert');
const { mergeJvmArgs, mergeGameArgs } = require('../src/core/minecraft/manifest');

test('mergeGameArgs: fusiona base (vanilla) + child (fml) sin perder opciones obligatorias', () => {
  const base = ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', '--version', '${version_name}'];
  const child = ['--fml.mcVersion', '26.2', '--fml.neoForgeVersion', '26.2.0.59'];
  const out = mergeGameArgs(child, base);
  assert.ok(out.includes('--accessToken'), 'base accessToken debe seguir');
  assert.ok(out.includes('--version'), 'base version debe seguir');
  assert.ok(out.includes('--fml.mcVersion'), 'args del loader deben seguir');
});

test('mergeGameArgs: deduplica por flag (el child no pisa a la base)', () => {
  const base = ['--username', 'a', '--accessToken', 'tok'];
  const child = ['--accessToken', 'otro'];
  const out = mergeGameArgs(child, base);
  assert.strictEqual(out.filter((x) => x === '--accessToken').length, 1);
});

test('mergeGameArgs: tolera lados faltantes', () => {
  const base = ['--username', 'a'];
  assert.deepStrictEqual(mergeGameArgs(undefined, base), base);
  assert.deepStrictEqual(mergeGameArgs(base, undefined), base);
  assert.strictEqual(mergeGameArgs(undefined, undefined), undefined);
});

test('mergeJvmArgs: el loader no pierde natives_directory de la base', () => {
  const base = ['-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=vanilla'];
  const child = ['-Dminecraft.launcher.brand=family'];
  const out = mergeJvmArgs(child, base);
  assert.ok(out.includes('-Djava.library.path=${natives_directory}'), 'natives_directory debe seguir');
});
