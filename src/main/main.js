/**
 * EnvHub 主进程
 */
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')

const { ENVIRONMENTS, CATEGORIES } = require('./catalog/environments')
const detector = require('./detector')
const installer = require('./installer')
const uninstaller = require('./uninstaller')
const envvars = require('./envvars')
const { humanSize, probeSize } = require('./downloader')
const { fetchLatestVersion } = require('./detector')

const isDev = process.env.NODE_ENV === 'development'
let mainWindow = null

/* ---------------- 窗口 ---------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0d1117',
    show: false,
    autoHideMenuBar: true,
    title: 'EnvHub — 开发环境管理',
    icon: path.join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

/* ---------------- 任务管理 ---------------- */
/** 运行中的安装/卸载任务，用于进度推送 */
const runningTasks = new Map()

function makeEmitter(taskId) {
  return (evt) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('task:event', { taskId, ...evt })
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ================= IPC ================= */

// 环境目录
ipcMain.handle('env:list', async () => {
  return ENVIRONMENTS.map(e => ({
    id: e.id,
    name: e.name,
    category: e.category,
    icon: e.icon,
    color: e.color,
    homepage: e.homepage,
    description: e.description,
    sizeHint: e.sizeHint,
    tips: e.tips,
    strategy: e.installer?.strategy,
    adminRequired: !!e.installer?.adminRequired,
    heavy: !!e.installer?.heavy,
    uninstallStrategy: e.uninstall?.strategy,
    uninstallHint: e.uninstall?.hint || null,
    binaries: e.binaries,
    hasVersionApi: !!e.latest && e.latest.type !== 'static'
  }))
})

ipcMain.handle('env:categories', async () => CATEGORIES)

// 检测
ipcMain.handle('env:detect', async (event, { ids } = {}) => {
  detector.clearDetectionCache()
  const list = ids?.length ? ENVIRONMENTS.filter(e => ids.includes(e.id)) : ENVIRONMENTS
  const results = []
  for (let i = 0; i < list.length; i++) {
    try {
      results.push(await detector.detectOne(list[i]))
    } catch (e) {
      results.push({ id: list[i].id, installed: false, error: e.message })
    }
    event.sender.send('env:detect-progress', {
      current: i + 1, total: list.length, id: list[i].id, name: list[i].name
    })
  }
  return results
})

ipcMain.handle('env:latest', async (event, id) => {
  const env = ENVIRONMENTS.find(e => e.id === id)
  if (!env) return null
  return await fetchLatestVersion(env)
})

ipcMain.handle('env:check-updates', async (event, detections) => {
  const out = []
  for (const d of detections.filter(x => x.installed)) {
    const env = ENVIRONMENTS.find(e => e.id === d.id)
    if (!env) continue
    const latest = await fetchLatestVersion(env)
    out.push({
      id: d.id,
      current: d.version,
      latest,
      hasUpdate: !!(latest && latest !== 'latest' && d.version && detector.compareVersions(latest, d.version) > 0)
    })
    event.sender.send('env:update-progress', { id: d.id, latest, hasUpdate: out[out.length - 1].hasUpdate })
  }
  return out
})

ipcMain.handle('env:download-size', async (event, id, version) => {
  const env = ENVIRONMENTS.find(e => e.id === id)
  if (!env?.installer?.urlTemplate || !version) return null
  try {
    const url = env.installer.urlTemplate
      .replace(/\{\{version\}\}/g, version)
      .replace(/\{\{lang\}\}/g, 'zh-CN')
    const size = await probeSize(url)
    return { size, text: humanSize(size), url }
  } catch { return null }
})

// 安装
ipcMain.handle('env:install', async (event, { id, version }) => {
  const env = ENVIRONMENTS.find(e => e.id === id)
  if (!env) throw new Error('未知环境')
  const taskId = `install-${id}-${Date.now()}`
  const emit = makeEmitter(taskId)
  runningTasks.set(taskId, { id, type: 'install' })

  try {
    emit({ phase: 'start', message: `开始安装 ${env.name}` })
    const result = env.installer?.strategy === 'zip'
      ? await installer.installPortable(env, version, emit)
      : await installer.install(env, version, emit)

    // 安装后补写 PATH（绿色版需要）
    if (result.pathHint) {
      try {
        const r = await envvars.addToPath(result.pathHint, 'user')
        if (r.added) emit({ phase: 'path', message: `已添加到 PATH: ${result.pathHint}` })
      } catch (e) {
        emit({ phase: 'warn', message: `未能自动写入 PATH，请手动添加: ${e.message}` })
      }
    }

    // 写入环境变量提示
    detector.clearDetectionCache()
    runningTasks.delete(taskId)
    return { ok: true, taskId, result }
  } catch (e) {
    emit({ phase: 'error', message: `安装失败: ${e.message}` })
    runningTasks.delete(taskId)
    return { ok: false, taskId, error: e.message }
  }
})

// 卸载
ipcMain.handle('env:uninstall', async (event, { id, detection }) => {
  const env = ENVIRONMENTS.find(e => e.id === id)
  if (!env) throw new Error('未知环境')
  const taskId = `uninstall-${id}-${Date.now()}`
  const emit = makeEmitter(taskId)
  runningTasks.set(taskId, { id, type: 'uninstall' })

  try {
    emit({ phase: 'start', message: `开始卸载 ${env.name}` })
    const result = await uninstaller.uninstall(id, detection, emit)
    detector.clearDetectionCache()
    runningTasks.delete(taskId)
    return { ok: true, taskId, result }
  } catch (e) {
    emit({ phase: 'error', message: `卸载失败: ${e.message}` })
    runningTasks.delete(taskId)
    return { ok: false, taskId, error: e.message }
  }
})

/** 打开环境安装目录 */
ipcMain.handle('env:open-dir', async (event, dir) => {
  if (!dir) throw new Error('路径为空')
  const shellResult = await shell.openPath(dir)
  if (shellResult) throw new Error(shellResult)
  return { ok: true }
})

/** 用系统默认程序打开下载页 */
ipcMain.handle('env:open-external', async (event, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 http/https 链接')
  await shell.openExternal(url)
  return { ok: true }
})

/* ---------------- 环境变量 ---------------- */
ipcMain.handle('envvars:read', async () => envvars.readAll())

ipcMain.handle('envvars:save-path', async (event, { scope, entries }) => {
  // 写系统级 PATH 前先自动备份
  await envvars.backup('before-save')
  return envvars.savePath(scope, entries)
})

ipcMain.handle('envvars:add', async (event, { dir, scope }) => envvars.addToPath(dir, scope))
ipcMain.handle('envvars:remove', async (event, { dir, scope }) => envvars.removeFromPath(dir, scope))
ipcMain.handle('envvars:is-in-path', async (event, { dir, scope }) => envvars.isInPath(dir, scope))

ipcMain.handle('envvars:set', async (event, { name, value, scope }) => envvars.setVariable(name, value, scope))
ipcMain.handle('envvars:remove-var', async (event, { name, scope }) => envvars.removeVariable(name, scope))

ipcMain.handle('envvars:backup', async (event, tag) => envvars.backup(tag))
ipcMain.handle('envvars:list-backups', async () => envvars.listBackups())
ipcMain.handle('envvars:restore', async (event, file) => envvars.restore(file))

/* ---------------- 通用 ---------------- */
ipcMain.handle('app:info', async () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  isAdmin: await envvars.isAdmin(),
  platform: process.platform,
  arch: process.arch,
  home: require('os').homedir(),
  staging: installer.STAGING
}))

ipcMain.handle('app:open-staging', async () => {
  await fs.promises.mkdir(installer.STAGING, { recursive: true })
  await shell.openPath(installer.STAGING)
  return { ok: true }
})

ipcMain.handle('app:confirm', async (event, { title, message, detail, danger }) => {
  const r = await dialog.showMessageBox(mainWindow, {
    type: danger ? 'warning' : 'question',
    buttons: danger ? ['取消', '确认执行'] : ['取消', '确定'],
    defaultId: danger ? 0 : 1,
    cancelId: 0,
    title: title || 'EnvHub',
    message: message || '确认操作',
    detail: detail || ''
  })
  return { confirmed: r.response === 1 }
})

ipcMain.handle('app:prompt', async (event, { title, label, defaultValue, placeholder }) => {
  const r = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['取消', '确定'],
    defaultId: 1,
    cancelId: 0,
    title: title || '输入',
    message: label || '',
    detail: placeholder || '',
    inputField: defaultValue || ''
  })
  // MessageBox 无输入框时用简易回退
  return { confirmed: r.response === 1, value: defaultValue || '' }
})

ipcMain.handle('app:log', async (event, { level, message }) => {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] [${level || 'info'}] ${message}`)
  return { ok: true }
})