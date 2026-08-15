// src/main/updater.js
// Orquestación "electron-aware" del actualizador. La lógica pura (check de la
// API de GitHub, semver, selección de asset, descarga) vive en core/updater;
// acá está lo que necesita Electron: ubicación de descarga, aplicar el
// instalador y cerrar la app.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const updater = require('../core/updater');

// owner/repo configurado (config.updater.repo); '' = desactivado.
function repoOf(cfg) {
  const u = (cfg && cfg.updater) || {};
  return String(u.repo || '').trim();
}

// Carpeta donde se guardan los instaladores bajados (reutilizable: no se
// borra al actualizar, así si la descarga falla a medias se puede reintentar).
function downloadsDir() {
  const dir = path.join(app.getPath('userData'), 'updates');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* y queda */ }
  return dir;
}

async function check(cfg) {
  const repo = repoOf(cfg);
  if (!repo) return { updateAvailable: false, error: 'repo de actualizaciones no configurado' };
  const u = cfg.updater || {};
  try {
    const result = await updater.checkForUpdate({
      repo,
      currentVersion: app.getVersion(),
      channel: u.channel || 'latest'
    });
    // No volver a ofrecer la versión que el usuario ya postergó.
    if (result.updateAvailable && u.dismissedVersion === result.version) {
      result.updateAvailable = false;
      result.dismissed = true;
    }
    return result;
  } catch (e) {
    return { updateAvailable: false, error: e.message, transient: true };
  }
}

async function download(asset, onProgress) {
  const dest = path.join(downloadsDir(), updater.safeAssetName(asset.name));
  await updater.downloadAsset(asset, dest, onProgress);
  return dest;
}

// Aplica el instalador descargado. En dev (sin empaquetar) no reinicia la app:
// solo abre el archivo para poder probar el flujo.
async function apply(installerPath) {
  if (!app.isPackaged) {
    const { shell } = require('electron');
    shell.showItemInFolder(installerPath);
    return { status: 'downloaded', file: installerPath };
  }

  const p = process.platform;
  if (p === 'win32') {
    // NSIS: instalación silenciosa y relanzamos la app apenas termina. El
    // instalador corre en un cmd desacoplado que espera (/wait) y después
    // vuelve a abrir el launcher (process.execPath = ruta del exe actual,
    // que es donde el instalador deja la versión nueva).
    const relaunchCmd =
      'start "" /wait "' + installerPath + '" /S & start "" "' + process.execPath + '"';
    spawn('cmd.exe', ['/c', relaunchCmd], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return { status: 'installing' };
  }

  if (p === 'linux') {
    // AppImage: se reemplaza el archivo actual y se relanza (electron-builder
    // con target AppImage deja la app montada desde /tmp; el original está en
    // $APPIMAGE). Si es .deb u otro, solo abrimos la carpeta.
    if (/\.AppImage$/i.test(installerPath) && process.env.APPIMAGE) {
      try {
        fs.copyFileSync(installerPath, process.env.APPIMAGE);
        fs.chmodSync(process.env.APPIMAGE, 0o755);
        spawn(process.env.APPIMAGE, [], { detached: true, stdio: 'ignore' }).unref();
        app.quit();
        return { status: 'installing' };
      } catch (e) {
        const { shell } = require('electron');
        shell.showItemInFolder(installerPath);
        return { status: 'downloaded', file: installerPath, error: e.message };
      }
    }
    const { shell } = require('electron');
    shell.showItemInFolder(installerPath);
    return { status: 'downloaded', file: installerPath };
  }

  // macOS y otros: abrimos el dmg; el usuario arrastra la app (sin firma no
  // se puede reemplazar la .app en caliente de forma confiable).
  const { shell } = require('electron');
  shell.openPath(installerPath);
  return { status: 'downloaded', file: installerPath };
}

module.exports = { check, download, apply, repoOf, downloadsDir };
