// Regresión: la versión 1.20.5+ de Minecraft agrega el flag
// --sun-misc-unsafe-memory-access=allow (solo existe en Java 24+). Si el
// runtime es menor a 24, hay que filtrarlo o la JVM no arranca.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildLaunchCommand } = require('../src/core/minecraft/launch');
const { requiredMajorForVersion } = require('../src/core/java');

function buildVersion(jvmArgs) {
  return {
    id: '1.21.4',
    mainClass: 'net.minecraft.client.main.Main',
    arguments: { jvm: [...jvmArgs, '-Dminecraft.launcher.brand=vanilla'], game: ['--server', 'x'] },
    assetIndex: { id: '1.21' }
  };
}

const ACCOUNT = { username: 't', uuid: '0', accessToken: 'x' };

test('launch: con Java >= 24 se conserva el flag de unsafe-memory-access', () => {
  const { args } = buildLaunchCommand({
    account: ACCOUNT,
    profile: { versionId: '1.21.4', memory: { min: 512, max: 1024 }, javaMajor: 24 },
    javaPath: 'java',
    gameDir: '/g',
    libClassPath: ['lib.jar'],
    versionDetails: buildVersion(['--sun-misc-unsafe-memory-access=allow'])
  });
  assert.ok(args.includes('--sun-misc-unsafe-memory-access=allow'));
});

test('launch: con Java < 24 se filtra el flag de unsafe-memory-access', () => {
  const { args } = buildLaunchCommand({
    account: ACCOUNT,
    profile: { versionId: '1.21.4', memory: { min: 512, max: 1024 }, javaMajor: 21 },
    javaPath: 'java',
    gameDir: '/g',
    libClassPath: ['lib.jar'],
    versionDetails: buildVersion(['--sun-misc-unsafe-memory-access=allow'])
  });
  assert.ok(!args.includes('--sun-misc-unsafe-memory-access=allow'));
});

test('requiredMajorForVersion: 1.20.5+ y 1.21+ piden Java 24', () => {
  assert.strictEqual(requiredMajorForVersion('1.20.5'), 24);
  assert.strictEqual(requiredMajorForVersion('1.21.4'), 24);
  assert.strictEqual(requiredMajorForVersion('1.20.4'), 17);
  assert.strictEqual(requiredMajorForVersion('1.17'), 17);
  assert.strictEqual(requiredMajorForVersion('1.8'), 8);
  assert.strictEqual(requiredMajorForVersion('26.2'), 24);
});