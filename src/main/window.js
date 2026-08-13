// src/main/window.js
// Crea y configura las ventanas del launcher (principal y de mods).

const { BrowserWindow } = require('electron');
const path = require('path');

// Icono de las ventanas = logo del server. En Windows el shell prefiere .ico;
// en Linux/macOS el PNG funciona directo.
const appIcon = process.platform === 'win32'
  ? path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.ico')
  : path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png');

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    frame: false, // Ventana sin bordes del sistema (estilo launcher moderno)
    backgroundColor: '#08090c',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'js', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

// Referencia única de la ventana de mods (se reutiliza, no se duplica).
let modsWin = null;

function createModsWindow() {
  if (modsWin && !modsWin.isDestroyed()) {
    modsWin.focus();
    return modsWin;
  }
  modsWin = new BrowserWindow({
    width: 920,
    height: 740,
    minWidth: 720,
    minHeight: 560,
    frame: false,
    backgroundColor: '#08090c',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'js', 'preload_mods.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  modsWin.loadFile(path.join(__dirname, '..', 'renderer', 'mods.html'));
  modsWin.on('closed', () => { modsWin = null; });
  return modsWin;
}

module.exports = { createMainWindow, createModsWindow };
