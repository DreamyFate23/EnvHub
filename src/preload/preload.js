/**
 * Preload - 安全桥接层
 */
const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()

function on(channel, callback) {
  const wrapped = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('envhub', {
  env: {
    list: () => ipcRenderer.invoke('env:list'),
    categories: () => ipcRenderer.invoke('env:categories'),
    detect: (ids) => ipcRenderer.invoke('env:detect', { ids }),
    latest: (id) => ipcRenderer.invoke('env:latest', id),
    checkUpdates: (detections) => ipcRenderer.invoke('env:check-updates', detections),
    downloadSize: (id, version) => ipcRenderer.invoke('env:download-size', id, version),
    install: (id, version) => ipcRenderer.invoke('env:install', { id, version }),
    uninstall: (id, detection) => ipcRenderer.invoke('env:uninstall', { id, detection }),
    openDir: (dir) => ipcRenderer.invoke('env:open-dir', dir),
    openExternal: (url) => ipcRenderer.invoke('env:open-external', url)
  },
  envvars: {
    read: () => ipcRenderer.invoke('envvars:read'),
    savePath: (scope, entries) => ipcRenderer.invoke('envvars:save-path', { scope, entries }),
    add: (dir, scope) => ipcRenderer.invoke('envvars:add', { dir, scope }),
    remove: (dir, scope) => ipcRenderer.invoke('envvars:remove', { dir, scope }),
    isInPath: (dir, scope) => ipcRenderer.invoke('envvars:is-in-path', { dir, scope }),
    set: (name, value, scope) => ipcRenderer.invoke('envvars:set', { name, value, scope }),
    removeVar: (name, scope) => ipcRenderer.invoke('envvars:remove-var', { name, scope }),
    backup: (tag) => ipcRenderer.invoke('envvars:backup', tag),
    listBackups: () => ipcRenderer.invoke('envvars:list-backups'),
    restore: (file) => ipcRenderer.invoke('envvars:restore', file)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openStaging: () => ipcRenderer.invoke('app:open-staging'),
    confirm: (opts) => ipcRenderer.invoke('app:confirm', opts),
    log: (level, message) => ipcRenderer.invoke('app:log', { level, message })
  },
  events: {
    onTask: (cb) => on('task:event', cb),
    onDetectProgress: (cb) => on('env:detect-progress', cb),
    onUpdateProgress: (cb) => on('env:update-progress', cb)
  }
})