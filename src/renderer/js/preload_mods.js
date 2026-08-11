// src/renderer/js/preload_mods.js
// Puente seguro para la ventana de Mods: expone SOLO la API de mods,
// versiones (para elegir la del juego) y controles de ventana.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getVersions: (showSnapshots) => ipcRenderer.invoke('minecraft:getVersions', showSnapshots),
  onProgress: (cb) => ipcRenderer.on('minecraft:progress', (_e, p) => cb(p)),

  mods: {
    loaderState: (gameVersion) => ipcRenderer.invoke('mods:loaderState', gameVersion),
    installLoader: (type, gameVersion) => ipcRenderer.invoke('mods:installLoader', type, gameVersion),
    search: (query, gameVersion) => ipcRenderer.invoke('mods:search', { query, gameVersion }),
    install: (projectId, gameVersion, prefLoader) => ipcRenderer.invoke('mods:install', { projectId, gameVersion, prefLoader }),
    list: () => ipcRenderer.invoke('mods:list'),
    remove: (filename) => ipcRenderer.invoke('mods:remove', filename)
  },

  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
});