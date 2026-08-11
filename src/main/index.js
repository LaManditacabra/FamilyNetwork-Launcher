// src/main/index.js
// Punto de entrada del proceso principal de Electron.

const { app, ipcMain } = require('electron');
const { createMainWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc/handlers');

// Evita múltiples instancias de la app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Registra los handlers IPC ANTES de crear la ventana para evitar
// condiciones de carrera (la UI podría invocar antes de tener handlers).
function boot() {
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
