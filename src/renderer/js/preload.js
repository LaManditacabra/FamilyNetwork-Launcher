// src/renderer/js/preload.js
// Puente seguro entre el proceso principal y la interfaz.
// Expone una API limitada en window.api (contextIsolation activado).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAccount: () => ipcRenderer.invoke('auth:getAccount'),

  config: () => ipcRenderer.invoke('config:get'),
  setSkin: (id) => ipcRenderer.invoke('config:setSkin', id),

  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    add: (p) => ipcRenderer.invoke('profiles:add', p),
    update: (id, patch) => ipcRenderer.invoke('profiles:update', { id, patch }),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    select: (id) => ipcRenderer.invoke('profiles:select', id)
  },

  getVersions: (showSnapshots) => ipcRenderer.invoke('minecraft:getVersions', showSnapshots),
  getLatest: () => ipcRenderer.invoke('minecraft:getLatest'),
  installedVersions: () => ipcRenderer.invoke('minecraft:installedVersions'),
  removeVersion: (id) => ipcRenderer.invoke('minecraft:removeVersion', id),
  serverStatus: () => ipcRenderer.invoke('server:status'),
  serverStatusBedrock: () => ipcRenderer.invoke('server:statusBedrock'),
  launch: (payload) => ipcRenderer.invoke('minecraft:launch', payload),
  onProgress: (cb) => ipcRenderer.on('minecraft:progress', (_e, p) => cb(p)),

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: (asset) => ipcRenderer.invoke('updater:download', asset),
    dismiss: (version) => ipcRenderer.invoke('updater:dismiss', version),
    onProgress: (cb) => ipcRenderer.on('updater:progress', (_e, p) => cb(p))
  },

  mods: {
    loaderState: (gameVersion) => ipcRenderer.invoke('mods:loaderState', gameVersion),
    installLoader: (type, gameVersion) => ipcRenderer.invoke('mods:installLoader', type, gameVersion),
    search: (query, gameVersion, loader) => ipcRenderer.invoke('mods:search', { query, gameVersion, loader }),
    install: (projectId, gameVersion, loader) => ipcRenderer.invoke('mods:install', { projectId, gameVersion, loader }),
    list: () => ipcRenderer.invoke('mods:list'),
    remove: (filename) => ipcRenderer.invoke('mods:remove', filename)
  },

  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    openMods: () => ipcRenderer.invoke('window:openMods')
  }
});
