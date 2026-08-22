// src/core/minecraft/launch.js
// Construye el comando para ejecutar Minecraft (java -cp ... mainClass ...).

const path = require('path');
const { DIRS } = require('./constants');
const { currentOs, currentArch } = require('./libraries');

// Ruta del jar del cliente (canónica: versions/<id>/<id>.jar), la misma que
// usan la instalación de loaders y downloadClient/downloadVersion.
function getClientJarPath(gameDir, versionDetails) {
  return path.join(gameDir, DIRS.versions, versionDetails.id, `${versionDetails.id}.jar`);
}

// Une el cliente + libraries en el classpath (separador según SO).
function buildClasspath(clientJar, libClassPath) {
  const sep = process.platform === 'win32' ? ';' : ':';
  return [clientJar, ...libClassPath].join(sep);
}

// Evalúa reglas que pueden incluir "os" y "features".
function argAllowed(rules, features) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) {
      matches = rule.os.name === currentOs();
      if (matches && rule.os.arch && rule.os.arch !== currentArch()) matches = false;
    }
    if (matches && rule.features) {
      for (const [feat, want] of Object.entries(rule.features)) {
        if (Boolean(features[feat]) !== want) matches = false;
      }
    }
    if (rule.action === 'allow' && matches) allowed = true;
    if (rule.action === 'disallow' && matches) allowed = false;
  }
  return allowed;
}

// Reemplaza ${variable} en un argumento.
function replaceVars(arg, vars) {
  return arg.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const v = vars[name];
    return v === undefined ? '' : String(v);
  });
}

// Procesa un arreglo de argumentos (formato moderno con reglas).
function processArgs(argsList, vars, features) {
  const out = [];
  for (const item of argsList || []) {
    if (typeof item === 'string') {
      out.push(replaceVars(item, vars));
    } else if (item && item.rules) {
      if (argAllowed(item.rules, features)) {
        const value = Array.isArray(item.value) ? item.value : [item.value];
        for (const v of value) out.push(replaceVars(v, vars));
      }
    }
  }
  return out;
}

// Construye el comando completo de lanzamiento.
// account: { username, uuid, accessToken }
// profile: { versionId, memory:{min,max}, versionType, resolution? }
// javaPath: ruta al ejecutable java
// gameDir: directorio del juego
// libClassPath: arreglo de rutas absolutas de las libraries
// versionDetails: JSON detallado de la versión
// Devuelve { command, args }.
function buildLaunchCommand({ account, profile, javaPath, gameDir, libClassPath, versionDetails }) {
  const clientJar = getClientJarPath(gameDir, versionDetails);
  const nativesDir = path.join(gameDir, DIRS.versions, versionDetails.id, 'natives');
  const classpath = buildClasspath(clientJar, libClassPath);
  const assetsDir = path.join(gameDir, DIRS.assets);

  const vars = {
    auth_player_name: account.username,
    version_name: versionDetails.id,
    game_directory: gameDir,
    assets_root: assetsDir,
    assets_index_name: versionDetails.assetIndex ? versionDetails.assetIndex.id : versionDetails.assets,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    user_type: account.userType || 'msa',
    version_type: profile.versionType || versionDetails.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'family-launcher',
    launcher_version: '0.1.0',
    classpath: classpath,
    classpath_separator: process.platform === 'win32' ? ';' : ':',
    library_directory: path.join(gameDir, DIRS.libraries),
    user_properties: '{}'
  };

  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(profile.resolution)
  };
  if (profile.resolution) {
    vars.resolution_width = profile.resolution.width;
    vars.resolution_height = profile.resolution.height;
  }

  // JVM args.
  const memArgs = profile.memory
    ? [`-Xmx${profile.memory.max}M`, `-Xms${profile.memory.min}M`]
    : [];
  let jvmArgs;
  if (versionDetails.arguments && versionDetails.arguments.jvm) {
    jvmArgs = [...memArgs, ...processArgs(versionDetails.arguments.jvm, vars, features)];
  } else {
    jvmArgs = [
      ...memArgs,
      `-Djava.library.path=${nativesDir}`,
      '-cp', classpath
    ];
  }

  // Java 24+ agrega flags que las JVM viejas no reconocen (p. ej.
  // --sun-misc-unsafe-memory-access=allow, que solo existe en 24). Si el
  // runtime es menor a 24 se filtran para no romper el arranque.
  const javaMajor = profile.javaMajor || 0;
  jvmArgs = jvmArgs.filter((a) => {
    if (javaMajor >= 24) return true;
    if (a.startsWith('--sun-misc-unsafe-memory-access=')) return false;
    return true;
  });

  // Game args.
  let gameArgs;
  if (versionDetails.arguments && versionDetails.arguments.game) {
    gameArgs = processArgs(versionDetails.arguments.game, vars, features);
  } else if (versionDetails.minecraftArguments) {
    gameArgs = versionDetails.minecraftArguments
      .split(' ')
      .map((a) => replaceVars(a, vars));
  } else {
    throw new Error('No se encontraron argumentos de juego en la versión');
  }

  const args = [...jvmArgs, versionDetails.mainClass, ...gameArgs];
  return { command: javaPath, args };
}

module.exports = { buildLaunchCommand, getClientJarPath };
