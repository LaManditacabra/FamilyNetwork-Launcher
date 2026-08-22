// src/main/ipc/handlers.js
// Registra los canales de comunicación entre el proceso principal
// y la interfaz (renderer). Conecta auth y minecraft con la UI.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const dns = require('dns').promises;
const { app } = require('electron');
const { createModsWindow } = require('../window');
const auth = require('../../core/auth');
const mc = require('../../core/minecraft');
const java = require('../../core/java');
const config = require('../../core/config');
const loaders = require('../../core/minecraft/loaders');
const modrinth = require('../../core/mods/modrinth');
const updater = require('../updater');
const { resolvePath, offlineUuid } = require('../../utils');
const { zipContainsEntry } = require('../../utils/zip');

// authlib-injector: agente java que desvía las llamadas de Mojang al backend
// Yggdrasil (skins client-side). Se baja una vez en el gameDir.
const AUTH_INJECTOR_ARTIFACT = 'https://authlib-injector.yushi.moe/artifact/latest.json';

// Descarga authlib-injector.jar en gameDir si no existe. Lanza si no hay red.
async function ensureAuthlibInjector(gameDir) {
  const jar = path.join(gameDir, 'authlib-injector.jar');
  if (fs.existsSync(jar) && fs.statSync(jar).size > 10000) return jar;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const metaRes = await fetch(AUTH_INJECTOR_ARTIFACT, { signal: ctrl.signal });
    const meta = await metaRes.json();
    const dl = await fetch(meta.download_url, { signal: ctrl.signal });
    if (!dl.ok) throw new Error('HTTP ' + dl.status);
    const buf = Buffer.from(await dl.arrayBuffer());
    fs.writeFileSync(jar, buf);
    console.log('[SKIN] authlib-injector.jar descargado (' + buf.length + ' bytes)');
    return jar;
  } finally {
    clearTimeout(timer);
  }
}

function registerIpcHandlers(ipcMain) {
  // ---- Cuenta ----
  ipcMain.handle('auth:login', async () => auth.login());

  ipcMain.handle('auth:logout', async () => {
    auth.logout();
    return true;
  });

  ipcMain.handle('auth:getAccount', async () => auth.ensureValid());

  // ---- Configuración y perfiles ----
  ipcMain.handle('config:get', async () => config.loadConfig());

  // ID único por instalación (dueño de las skins propias).
  ipcMain.handle('config:getDeviceId', async () => config.getDeviceId());

  ipcMain.handle('profiles:list', async () => ({
    profiles: config.getProfiles(),
    selected: config.loadConfig().selectedProfileId
  }));

  ipcMain.handle('profiles:add', async (_e, p) => config.addProfile(p));

  ipcMain.handle('profiles:update', async (_e, { id, patch }) => config.updateProfile(id, patch));

  ipcMain.handle('profiles:remove', async (_e, id) => {
    config.removeProfile(id);
    return true;
  });

  ipcMain.handle('profiles:select', async (_e, id) => {
    config.saveConfig({ selectedProfileId: id });
    return true;
  });

  // Skin global del selector (independiente del perfil).
  ipcMain.handle('config:setSkin', async (_e, id) => {
    config.saveConfig({ selectedSkinId: (id || '').toString() });
    return true;
  });

  // ---- Controles de la ventana (frame: false) ----
  ipcMain.handle('window:minimize', (event) => {
    event.sender.getOwnerBrowserWindow().minimize();
  });
  ipcMain.handle('window:toggleMaximize', (event) => {
    const w = event.sender.getOwnerBrowserWindow();
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle('window:close', (event) => {
    event.sender.getOwnerBrowserWindow().close();
  });

  // ---- Actualizador del launcher (releases de GitHub) ----
  ipcMain.handle('updater:check', async () => updater.check(config.loadConfig()));

  // Descarga y aplica el update. Devuelve { status: 'installing' | 'downloaded' }.
  ipcMain.handle('updater:download', async (event, asset) => {
    if (!asset || !asset.browser_download_url) throw new Error('Asset de update inválido');
    const progress = (p) => { if (event && event.sender) event.sender.send('updater:progress', p); };
    const file = await updater.download(asset, progress);
    return updater.apply(file);
  });

  // El usuario posterga la versión: no se la volvemos a ofrecer en la próxima apertura.
  ipcMain.handle('updater:dismiss', (_e, version) => {
    config.saveConfig({ updater: { dismissedVersion: String(version || '') } });
    return true;
  });

  // ---- Estado del servidor (hero) ----
  // Probe UDP estilo RakNet (protocolo de Bedrock): envía un Unconnected Ping
  // y considera online si recibe una respuesta con la magia de RakNet.
  const dgram = require('dgram');
  const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');

  function probeUdpRaknet(host, port, timeout = 4000) {
    return new Promise((resolve) => {
      const sock = dgram.createSocket('udp4');
      const ping = Buffer.alloc(1 + 8 + RAKNET_MAGIC.length);
      ping.writeUInt8(0x01, 0);
      ping.writeBigInt64BE(BigInt(Date.now()), 1);
      RAKNET_MAGIC.copy(ping, 1 + 8);
      const timer = setTimeout(() => { try { sock.close(); } catch {} resolve(false); }, timeout);
      sock.once('message', (msg) => {
        clearTimeout(timer);
        try { sock.close(); } catch {}
        resolve(msg.length >= 1 + RAKNET_MAGIC.length && msg.includes(RAKNET_MAGIC));
      });
      sock.once('error', () => { clearTimeout(timer); try { sock.close(); } catch {} resolve(false); });
      sock.send(ping, port, host, (err) => {
        if (err) { clearTimeout(timer); try { sock.close(); } catch {} resolve(false); }
      });
    });
  }

  ipcMain.handle('server:status', async () => {
    const ip = 'katherine-awakenings.tun.ply.gg';

    // Fallback directo por TCP: si mcsrvstat no responde (p. ej. resoluciones
    // solo-IPv6 que a veces fallan), probamos conexión real al puerto de juego.
    async function probeTcpPort() {
      const portHint = 52270; // puerto SRV del túnel playit (DNS SRV _minecraft._tcp)
      const addresses = await dns.lookup(ip, { all: true }).catch(() => []);
      const candidates = [
        ...addresses.map((a) => ({ host: a.address, port: portHint })),
        { host: ip, port: portHint }
      ];
      for (const { host, port } of candidates) {
        const ok = await new Promise((resolve) => {
          const s = net.connect({ host, port, timeout: 4000 });
          s.once('connect', () => { s.destroy(); resolve(true); });
          s.once('error', () => { s.destroy(); resolve(false); });
          s.once('timeout', () => { s.destroy(); resolve(false); });
        });
        if (ok) return true;
      }
      return false;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://api.mcsrvstat.us/3/' + ip, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.online) {
        return { online: true, players: Number(data.players?.online ?? 0), ip };
      }
      // mcsrvstat dice offline: confirmamos con un probe TCP real antes de dar por caído.
      const reachable = await probeTcpPort();
      if (reachable) return { online: true, players: 0, ip, method: 'tcp-probe' };
      return { online: false, ip };
    } catch (e) {
      console.warn('[server:status]', e.message);
      const reachable = await probeTcpPort();
      if (reachable) return { online: true, players: 0, ip, method: 'tcp-probe' };
      return { online: null, ip, error: e.message };
    }
  });

  // ---- Estado del servidor Bedrock (hero) ----
  ipcMain.handle('server:statusBedrock', async () => {
    const ip = 'katherine-roof.tun.ply.gg';
    const port = 56601;

    // Probe UDP RakNet directo: Bedrock está sobre IPv6; usar el socket adecuado.
    async function probeBedrock() {
      const addresses = await dns.lookup(ip, { all: true }).catch(() => []);
      const candidates = [
        ...addresses.map((a) => ({ host: a.address, family: a.family })),
        { host: ip, family: 0 }
      ];
      for (const { host, family } of candidates) {
        const ok = await new Promise((resolve) => {
          const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
          const ping = Buffer.alloc(1 + 8 + RAKNET_MAGIC.length);
          ping.writeUInt8(0x01, 0);
          ping.writeBigInt64BE(BigInt(Date.now()), 1);
          RAKNET_MAGIC.copy(ping, 1 + 8);
          const timer = setTimeout(() => { try { sock.close(); } catch {} resolve(false); }, 4000);
          sock.once('message', (msg) => {
            clearTimeout(timer);
            try { sock.close(); } catch {}
            resolve(msg.length >= 1 + RAKNET_MAGIC.length && msg.includes(RAKNET_MAGIC));
          });
          sock.once('error', () => { clearTimeout(timer); try { sock.close(); } catch {} resolve(false); });
          sock.send(ping, port, host, (err) => {
            if (err) { clearTimeout(timer); try { sock.close(); } catch {} resolve(false); }
          });
        });
        if (ok) return true;
      }
      return false;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://api.mcsrvstat.us/bedrock/3/' + ip + ':' + port, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.online) {
        return { online: true, players: Number(data.players?.online ?? 0), ip };
      }
      const reachable = await probeBedrock();
      if (reachable) return { online: true, players: 0, ip, method: 'udp-probe' };
      return { online: false, ip };
    } catch (e) {
      console.warn('[server:statusBedrock]', e.message);
      const reachable = await probeBedrock();
      if (reachable) return { online: true, players: 0, ip, method: 'udp-probe' };
      return { online: null, ip, error: e.message };
    }
  });

  // ---- Versión del launcher (para la UI y el banner de updates) ----
  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged
  }));

  // ---- Versiones ----
  ipcMain.handle('minecraft:getVersions', async (_e, showSnapshots) => {
    const cfg = config.loadConfig();
    const list = await mc.getVersions(showSnapshots !== undefined ? showSnapshots : cfg.showSnapshots);
    // Suma las versiones Fabric instaladas localmente a la lista del selector.
    const gameDir = resolvePath(cfg.gameDirectory);
    const installed = mc.getInstalledVersions(gameDir);
    if (installed.length) list.push(...installed);
    return list;
  });

  ipcMain.handle('minecraft:getLatest', async () => mc.getLatest());

  // Versiones instaladas localmente (vanillas bajadas + loaders), para gestionar.
  ipcMain.handle('minecraft:installedVersions', async () => {
    const cfg = config.loadConfig();
    return mc.listInstalledLocalVersions(resolvePath(cfg.gameDirectory));
  });

  // Desinstala una versión: borra su carpeta versions/<id> y los perfiles que
  // apuntaban a ella. Las libraries son compartidas y no se tocan.
  ipcMain.handle('minecraft:removeVersion', async (_e, versionId) => {
    const cfg = config.loadConfig();
    const gameDir = resolvePath(cfg.gameDirectory);
    const id = String(versionId || '');
    // Solo ids de versiones (sin barras/dots peligrosos => sin path traversal).
    if (!/^[A-Za-z0-9._\-\+]+$/.test(id)) {
      throw new Error('Identificador de versión inválido');
    }
    if (!mc.removeInstalledVersion(gameDir, id)) {
      throw new Error('La versión "' + id + '" no está instalada');
    }
    // Limpia perfiles que la referenciaban para no lanzar una versión inexistente.
    for (const p of config.getProfiles()) {
      if (p.versionId === id) config.removeProfile(p.id);
    }
    return true;
  });

  // ---- Mods (loaders Fabric/Forge/NeoForge + Modrinth) ----
  // Abre (o enfoca) la ventana dedicada de mods.
  ipcMain.handle('window:openMods', () => {
    createModsWindow();
    return true;
  });

  // ¿Qué loaders (y con qué id) ya están instalados para la versión de juego?
  ipcMain.handle('mods:loaderState', async (_e, gameVersion) => {
    const cfg = config.loadConfig();
    const gameDir = resolvePath(cfg.gameDirectory);
    return mc.getInstalledVersions(gameDir)
      .filter((v) => loaders.gameVersionOf(v.id) === String(gameVersion || ''))
      .map((v) => ({ type: v.type, versionId: v.id }));
  });

  // Instala un loader (fabric | forge | neoforge) para la versión de juego.
  ipcMain.handle('mods:installLoader', async (event, type, gameVersion) => {
    const cfg = config.loadConfig();
    const gameDir = resolvePath(cfg.gameDirectory);
    const progress = (p) => { if (event && event.sender) event.sender.send('minecraft:progress', p); };
    const id = await loaders.installLoader(type, gameVersion, gameDir, progress);
    return { id };
  });

  // Busca mods en Modrinth compatibles con la versión (sin filtrar por loader:
  // la lista es única y cada mod indica en su tarjeta con qué loader funciona).
  ipcMain.handle('mods:search', async (_e, { query, gameVersion }) =>
    modrinth.searchMods(query || '', gameVersion || ''));

  // Descarga e instala un mod. Valida compatibilidades primero: cada jar se
  // inspecciona (versión de Minecraft que exige + dependencias required) en una
  // carpeta temporal; si algo no es compatible con la versión de juego elegida,
  // aborta SIN tocar la carpeta mods (loader incluido solo si al final todo OK).
  ipcMain.handle('mods:install', async (event, { projectId, gameVersion, prefLoader }) => {
    const cfg = config.loadConfig();
    const gameDir = resolvePath(cfg.gameDirectory);
    const progress = (p) => { if (event && event.sender) event.sender.send('minecraft:progress', p); };
    const staging = path.join(gameDir, '.modstaging', Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    const dropStaging = () => { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ } };
    try { fs.mkdirSync(staging, { recursive: true }); } catch { /* y queda */ }

    const { files, missing } = await modrinth.resolveModTree(projectId, gameVersion, prefLoader || '');
    const main = files[0];
    if (!main) { dropStaging(); throw new Error('No hay versión de este mod compatible con ' + gameVersion); }
    if (missing.length) {
      const names = await Promise.all(missing.map((id) => modrinth.projectTitle(id)));
      dropStaging();
      throw new Error(
        '"' + main.filename + '" necesita ' + names.join(', ') +
        ', que no tienen versión para Minecraft ' + gameVersion + '. ' +
        'Probá con la versión de juego que soporta el ecosistema de ese mod.'
      );
    }

    // 1) Descarga TODO a staging, leyendo deps y comprobando la versión de MC
    //    que exige cada jar. Nada se mueve a mods/ todavía.
    const seenProjects = new Set();
    const installed = new Set();
    const problems = [];
    let pending = files;
    let passes = 0;
    try {
      while (pending.length && passes < 60) {
        const batch = pending.filter((f) => !installed.has(f.filename));
        for (const f of batch) {
          installed.add(f.filename);
          await modrinth.installMod(f, staging, progress);
          if (!modrinth.jarMinecraftCompatible(path.join(staging, 'mods', f.filename), gameVersion)) {
            problems.push(f.filename + ' (exige otra versión de Minecraft)');
          }
        }

        const next = [];
        for (const f of batch) {
          if (!f.projectId || seenProjects.has(f.projectId)) continue;
          seenProjects.add(f.projectId);
          const jarPath = path.join(staging, 'mods', f.filename);
          const depIds = modrinth.requiredModIdsFromJar(jarPath, main.loader);
          for (const depId of depIds) {
            const projId = await modrinth.depToProjectId(depId, main.loader);
            if (!projId) { problems.push(depId); continue; }
            if (seenProjects.has(projId)) continue;
            const r = await modrinth.resolveModTree(projId, gameVersion, main.loader);
            if (r.files.length) {
              if (r.missing.length) r.missing.forEach((id) => problems.push(id));
              next.push(...r.files);
            } else {
              problems.push(depId);
            }
          }
        }
        pending = next;
        passes++;
      }
    } catch (err) {
      dropStaging();
      throw err;
    }

    // 2) Incompatibilidad detectada: abortar sin dejar mods parciales.
    if (problems.length) {
      dropStaging();
      const names = await Promise.all(problems.filter((p) => /^[A-Za-z0-9_-]+$/.test(p)).map((p) => modrinth.projectTitle(p)));
      throw new Error(
        'No se puede instalar "' + main.filename + '" en Minecraft ' + gameVersion + ': ' +
        (names.length ? names.join(', ') : problems.join('; ')) + '. ' +
        'El ecosistema de ese mod probablemente soporta otra versión (p. ej. Cobblemon usa 1.21.1).'
      );
    }

    // 3) Loader requerido por el mod (recién acá, cuando todo lo demás OK).
    let loaderInstalled = false;
    if (loaders.LOADERS.includes(main.loader)) {
      const have = mc.getInstalledVersions(gameDir)
        .filter((v) => loaders.gameVersionOf(v.id) === String(gameVersion))
        .map((v) => loaders.loaderOfId(v.id));
      if (!have.includes(main.loader)) {
        await loaders.installLoader(main.loader, gameVersion, gameDir, progress);
        loaderInstalled = true;
      }
    }

    // 4) Finalizar: mover los jars validados a mods/.
    const modsDir = modrinth.modsDirOf(gameDir);
    try { fs.mkdirSync(modsDir, { recursive: true }); } catch { /* y queda */ }
    for (const filename of installed) {
      const src = path.join(staging, 'mods', filename);
      const dest = path.join(modsDir, filename);
      if (fs.existsSync(dest)) fs.rmSync(dest);
      fs.renameSync(src, dest);
    }
    dropStaging();

    return {
      filename: main.filename,
      version: main.versionNumber,
      loader: main.loader,
      loaderInstalled,
      depsCount: installed.size - 1,
      missingDeps: []
    };
  });

  ipcMain.handle('mods:list', async () => {
    const cfg = config.loadConfig();
    return modrinth.listInstalledMods(resolvePath(cfg.gameDirectory));
  });

  ipcMain.handle('mods:remove', async (_e, filename) => {
    const cfg = config.loadConfig();
    modrinth.removeMod(filename, resolvePath(cfg.gameDirectory));
    return true;
  });

  // ---- Lanzar el juego ----
  // payload: { versionId, account, memory?, skin? }
  ipcMain.handle('minecraft:launch', async (event, { versionId, account, memory, skin }) => {
    // Soporta modo offline: el UUID se deriva del nombre (determinístico), así
    // el backend Yggdrasil y SkinsRestorer comparten la misma identidad.
    const isOffline = !account || !account.accessToken || account.accessToken === 'offline';
    const name = (account && account.username) || 'Player';
    if (isOffline) {
      account = {
        username: name,
        uuid: offlineUuid(name),
        accessToken: 'offline',
        userType: 'mojang'
      };
    }

    const cfg = config.loadConfig();
    const gameDir = resolvePath(cfg.gameDirectory);

    // Resuelve un Java compatible (instalado o descargado).
    const javaPath = await java.ensureJava(versionId, gameDir, (p) => {
      if (event && event.sender) event.sender.send('minecraft:progress', p);
    });
    // Major de la JVM que se va a usar: sirve para filtrar flags que solo
    // existen en Java 24+ (p. ej. --sun-misc-unsafe-memory-access=allow).
    const javaMajor = await java.getJavaVersion(javaPath);

    const { classPath, details } = await mc.downloadVersion(versionId, gameDir, (p) => {
      if (event && event.sender) event.sender.send('minecraft:progress', p);
    });

    // Verifica que el cliente jar exista y no esté vacío; reintenta si falta.
    const clientJar = mc.getClientJarPath(gameDir, details);
    if (!fs.existsSync(clientJar) || fs.statSync(clientJar).size < 1000) {
      console.log('[MC] cliente no encontrado, reintentando descarga...');
      await mc.downloadClient(versionId, gameDir);
    }
    if (!fs.existsSync(clientJar) || fs.statSync(clientJar).size < 1000) {
      throw new Error(
        'No se pudo obtener el cliente de Minecraft. Revisa tu conexión a launcher.mojang.com ' +
        '(el archivo no se descargó en ' + clientJar + ').'
      );
    }

    // Verifica que el jar contenga la clase principal (detecta bins corruptos).
    // En versiones con loader (fabric, forge, neoforge) la clase principal vive
    // en un jar de la librería, así que esa comprobación solo aplica a vanilla.
    const mainClassEntry = details.mainClass.replace(/\./g, '/') + '.class';
    if (!loaders.isLoaderId(versionId) && !zipContainsEntry(clientJar, mainClassEntry)) {
      throw new Error(
        'El cliente de Minecraft está corrupto: no contiene la clase principal (' + details.mainClass + '). ' +
        'Tu conexión probablemente está entregando un binario incorrecto de Mojang. ' +
        'Borrá la carpeta versions\\' + versionId + ' y volvé a intentar; si persiste, ' +
        'usá otra red (el launcher oficial de Minecraft fallaría igual en esta conexión).'
      );
    }

    const cmd = mc.buildLaunchCommand({
      account,
      profile: { versionId, memory: memory || cfg.memory, versionType: details.type, javaMajor },
      javaPath,
      gameDir,
      libClassPath: classPath,
      versionDetails: details
    });

    // Skins client-side: activa authlib-injector contra el backend Yggdrasil.
    // Solo si hay internet y el backend responde; si no, se lanza el perfil
    // offline normal sin inyectar nada.
    const yg = cfg.yggdrasil || {};
    if (isOffline && yg.enabled !== false && yg.api) {
      try {
        const apiUrl = String(yg.api).replace(/\/+$/, '');
        const probe = new AbortController();
        const pt = setTimeout(() => probe.abort(), 3000);
        const reachable = await fetch(apiUrl + '/', { signal: probe.signal })
          .then((r) => r.ok)
          .catch(() => false);
        clearTimeout(pt);
        if (reachable) {
          const jar = await ensureAuthlibInjector(gameDir);
          cmd.args.unshift(`-javaagent:${jar}=${apiUrl}`);
          console.log('[SKIN] authlib-injector activo ->', apiUrl);
        } else {
          console.warn('[SKIN] backend Yggdrasil no alcanzable; sin skin client-side');
        }
      } catch (e) {
        console.warn('[SKIN] sin authlib-injector (sin red?):', e.message);
      }
    }

    // Diagnóstico: ayuda a detectar classpath demasiado largo en Windows.
    const cpIndex = cmd.args.indexOf('-cp');
    const cpValue = cpIndex >= 0 ? cmd.args[cpIndex + 1] : '';
    console.log('[MC] cliente:', clientJar, 'size:', fs.statSync(clientJar).size);
    console.log('[MC] classpath length:', cpValue.length, '(límite recomendado < 32000)');
    if (process.platform === 'win32' && cpValue.length > 32000) {
      console.warn('[MC] ADVERTENCIA: el classpath supera el límite de línea de comandos de Windows.');
    }

    // Aplica la skin predefinida en el servidor ANTES de lanzar el juego, para
    // que el perfil ya esté listo cuando authlib-injector consulte el backend
    // (evita que el cliente arranque sin skin en el primer lanzamiento).
    // Best-effort: si falla, igual se lanza el juego.
    const skinName = skin && skin.trim();
    if (skinName && cfg.skinApi && cfg.skinApi.url) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(cfg.skinApi.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.skinApi.token ? { Authorization: 'Bearer ' + cfg.skinApi.token } : {})
          },
          body: JSON.stringify({ player: account.username, skin: skinName, owner: config.getDeviceId() }),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        console.log('[SKIN]', res.status, res.ok ? 'aplicado' : 'rechazado', '->', account.username, skinName);
      } catch (e) {
        console.warn('[SKIN] no se pudo aplicar skin:', e.message);
      }
    } else if (skin && skin.trim()) {
      console.warn('[SKIN] sin endpoint configurado (skinApi.url); skin "' + skin.trim() + '" no aplicada');
    }

    const child = spawn(cmd.command, cmd.args, { cwd: gameDir, windowsHide: false });
    const logPath = path.join(gameDir, 'launch.log');
    const sink = (tag) => (d) => {
      const line = d.toString();
      try { fs.appendFileSync(logPath, `[${tag}] ${line}`); } catch { /* best effort */ }
      if (tag === 'err') console.error('[MC-err]', line);
      else console.log('[MC]', line);
    };
    child.stdout.on('data', sink('out'));
    child.stderr.on('data', sink('err'));
    child.on('error', (e) => {
      console.error('[MC] spawn error:', e.message);
      try { fs.appendFileSync(logPath, `[spawn-error] ${e.message}\n`); } catch { /* best effort */ }
      if (event && event.sender) event.sender.send('minecraft:launch-error', e.message);
    });
    child.on('exit', (code, signal) => {
      console.log('[MC] proceso terminó con código', code, 'señal', signal);
      try { fs.appendFileSync(logPath, `[exit] code=${code} signal=${signal}\n`); } catch { /* best effort */ }
      if (event && event.sender && code !== 0) {
        event.sender.send('minecraft:launch-exited', { code, signal, log: logPath });
      }
    });

    return { pid: child.pid };
  });
}

module.exports = { registerIpcHandlers };
