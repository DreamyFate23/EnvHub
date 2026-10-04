/**
 * 无头模式验证: 用 Electron 的 offscreen 渲染跑一遍主进程逻辑，
 * 确认 IPC 注册与环境检测在 Electron 环境下正常。
 */
const { app, BrowserWindow } = require('electron')

// 沙箱/无显卡环境需要禁用 GPU 加速
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('in-process-gpu')

app.whenReady().then(async () => {
  const log = []
  const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s) }

  say('Electron 版本:', process.versions.electron)

  // 加载主进程（会注册所有 IPC handler）
  require('./src/main/main.js')

  const win = new BrowserWindow({
    width: 1280, height: 840, show: false,
    webPreferences: {
      preload: require('path').join(__dirname, 'src/preload/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  })

  win.webContents.on('console-message', (_e, _l, msg) => {
    if (msg.includes('Error') || msg.includes('error')) say('  [renderer]', msg)
  })

  try {
    await win.loadFile(require('path').join(__dirname, 'dist/index.html'))
    say('渲染进程加载: OK')
  } catch (e) {
    say('渲染进程加载失败:', e.message)
  }

  // 在渲染进程里实际调用 IPC，验证完整链路
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      if (!window.envhub) return { error: 'preload 未注入 window.envhub' }
      try {
        const envs = await window.envhub.env.list()
        const cats = await window.envhub.env.categories()
        const dets = await window.envhub.env.detect()
        const info = await window.envhub.app.info()
        const installed = dets.filter(d => d.installed)
        return {
          envCount: envs.length,
          catCount: cats.length,
          detected: dets.length,
          installedCount: installed.length,
          installedList: installed.map(d => d.id + '@' + (d.version || '?')),
          appVersion: info.version,
          isAdmin: info.isAdmin
        }
      } catch (e) { return { error: e.message } }
    })()
  `)

  say('IPC 测试结果:', JSON.stringify(result, null, 2))

  // 等待界面完成初始渲染（扫描动画结束）后再截图
  say('等待界面渲染完成...')
  await new Promise(r => setTimeout(r, 6000))

  try {
    const img = await win.webContents.capturePage()
    const fs = require('fs')
    fs.writeFileSync(require('path').join(__dirname, 'preview.png'), img.toPNG())
    say('界面截图已保存: preview.png')
  } catch (e) {
    say('截图失败:', e.message)
  }

  // 顺便验证环境变量页
  try {
    const varsResult = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const v = await window.envhub.envvars.read()
          const b = await window.envhub.envvars.listBackups()
          return {
            userPathCount: v.user.path.length,
            systemPathCount: v.system.path.length,
            isAdmin: v.isAdmin,
            backups: b.length,
            extras: Object.keys(v.extras || {})
          }
        } catch (e) { return { error: e.message } }
      })()
    `)
    say('环境变量模块:', JSON.stringify(varsResult, null, 2))
  } catch (e) {
    say('环境变量测试失败:', e.message)
  }

  require('fs').writeFileSync(
    require('os').tmpdir() + '\\eh-verify.txt',
    log.join('\n'), 'utf8'
  )
  app.exit(0)
}).catch(e => {
  require('fs').writeFileSync(
    require('os').tmpdir() + '\\eh-verify.txt',
    'FATAL: ' + e.stack, 'utf8'
  )
  app.exit(1)
})