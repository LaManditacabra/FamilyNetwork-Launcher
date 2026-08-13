// src/main/index.js
// Punto de entrada del proceso principal de Electron.

const { app, ipcMain } = require('electron');
const { createMainWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc/handlers');
const { setDataRoot } = require('../utils');

// Evita múltiples instancias de la app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Registra los handlers IPC ANTES de crear la ventana para evitar
// condiciones de carrera (la UI podría invocar antes de tener handlers).
function boot() {
  // Empaquetado: la carpeta de datos va a userData (config, perfiles, cuenta),
  // porque escribir dentro del app.asar de solo lectura tiraría ENOTDIR.
  if (app.isPackaged) {
    setDataRoot(app.getPath('userData'));
    console.log('[main] datos en', require('../core/config/store').dataDir());
  }
  registerIpcHandlers(ipcMain);
  createMainWindow();

  app.on('activate', () => {
    if (require('electron').BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

// Log de errores no capturados en el main (ayuda a diagnosticar en consola).
process.on('uncaughtException', (err) => console.error('[main] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[main] unhandledRejection:', err));

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
