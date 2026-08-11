// Regresión: validación de compatibilidad de mods. El toml de NeoForge/Forge
// declara el owner en "[[dependencies.X]]" y la dep real en modId dentro del
// bloque (bug "car"); los rangos de Minecraft se comparan sin embarrar el
// token semver con los clasificadores.
const { test } = require('node:test');
const assert = require('node:assert');
const { minecraftRangeMatches, parseForgeTomlDeps } = require('../src/core/mods/modrinth');

test('parseForgeTomlDeps: usa el modId del bloque, no el owner (bug car)', () => {
  const toml = `modLoader = "javafml"
loaderVersion = "*"
[[mods]]
modId = "car"
version = "1.0.49+26.2"
[[dependencies.car]]
modId = "neoforge"
type = "required"
[[dependencies.car]]
modId = "minecraft"
type = "required"
[[dependencies.car]]
modId = "jei"
type = "optional"
[[dependencies.car]]
modId = "theoneprobe"
type = "optional"
[[dependencies.car]]
modId = "jade"
type = "optional"`;
  assert.deepStrictEqual(parseForgeTomlDeps(toml), []);
});

test('parseForgeTomlDeps: captura las required de verdad y las optional no', () => {
  const toml = `[[dependencies.mymod]]
modId = "geckolib"
type = "required"
versionRange = "[4.0,)"

[[dependencies.mymod]]
modId = "cloth-config"
type = "optional"

[[dependencies.mymod]]
modId = "some-lib"
mandatory = true

[[dependencies.mymod]]
modid = "javafml_dep"
mandatory = true`;
  const deps = parseForgeTomlDeps(toml);
  assert.ok(deps.includes('geckolib'));
  assert.ok(deps.includes('some-lib'), 'soporta mandatory = true');
  assert.ok(deps.includes('javafml_dep'), 'soporta modid en minúsculas');
  assert.ok(!deps.includes('cloth-config'), 'optional no debe sumarse');
  assert.ok(!deps.includes('mymod'), 'el owner no debe tomarse como dep');
});

test('parseForgeTomlDeps: sin modId en el bloque no inventa el owner', () => {
  assert.deepStrictEqual(parseForgeTomlDeps('[[dependencies.owner]]\nversionRange = "*"'), []);
});

test('minecraftRangeMatches: cubre los formatos de Mojang/Modrinth', () => {
  const cases = [
    ['1.21.1', '1.21.1', true], ['1.21.1', '1.21.3', false],
    ['>=1.21.1', '1.21.3', true], ['1.21.x', '1.21.3', true], ['1.21.x', '1.20.4', false],
    ['[1.21,2.0]', '1.21.3', true], ['1.19.4 || 1.20.1', '1.20.1', true],
    ['1.19.4 || 1.20.1', '1.21.1', false], ['>=1.21 <1.22', '1.21.3', true],
    ['>=1.21 <1.22', '1.19.4', false], ['>=1.21', '1.21.3', true],
    ['[*]', '1.21.3', true], ['1.21', '1.21.1', false]
  ];
  for (const [dep, gv, exp] of cases) {
    assert.strictEqual(minecraftRangeMatches(dep, gv), exp, `dep=${dep} gv=${gv}`);
  }
});
