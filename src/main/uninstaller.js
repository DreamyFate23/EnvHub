/**
 * 卸载引擎
 * 优先 QuietUninstallString，其次解析 UninstallString 并追加静默参数
 * 绿色版环境走「删除目录 + 清理 PATH」
 */
const fs = require('fs')
const path = require('path')
const { execAsync, elevate } = require('./utils')
const { ENV_MAP } = require('./catalog/environments')
const envvars = require('./envvars')

/** 已知静默卸载参数（按安装器类型） */
const SILENT_FLAGS = [
  '/S', '/s', '/silent', '/VERYSILENT', '/verysilent', '/quiet',
  '--unattended', '--quiet', '/Q', '/q'
]

/**
 * 从 UninstallString 中拆出可执行文件与参数
 * 处理 MsiExec.exe /X{GUID}、/I{GUID} 这类特殊形式
 */
function parseUninstallString(str) {
  if (!str) return null

  // MSI 形式: MsiExec.exe /X{GUID} 或 /I{GUID}
  const msi = str.match(/^(.*?msiexec\.exe)\s+\/([xXiI])\{?([A-Za-z0-9\-{}]+)\}?/i)
  if (msi) {
    const code = msi[2].toUpperCase()
    // 统一转成 /X{GUID}，并追加静默参数
    // 不追加 /qn 的话 MSI 会弹出交互式安装向导，卸载会卡住
    return {
      exe: msi[1],
      args: [`/X{${msi[3].replace(/[{}]/g, '')}}`, '/qn', '/norestart'],
      isMsi: true
    }
  }

  // 常规形式: "C:\path\unins.exe" /SILENT
  const m = str.match(/^\s*"([^"]+)"\s*(.*)$/) || str.match(/^\s*([^\s]+)\s*(.*)$/)
  if (!m) return null

  const exe = m[1]
  const base = m[2].trim()
  const ext = path.extname(exe).toLowerCase()
  const args = base ? base.split(/\s+/).filter(Boolean) : []

  // NSIS 风格需要 /S ; Inno 需要 /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
  let silentArgs = []
  if (ext === '.exe') {
    const lower = path.basename(exe).toLowerCase()
    if (lower.includes('unins') || lower.includes('uninstall')) {
      silentArgs = ['/S']
    } else if (lower.includes('setup')) {
      silentArgs = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']
    }
  }

  // 去重，避免原始字符串已带 /S 时出现 "/S /S"
  const seen = new Set()
  const finalArgs = [...args, ...silentArgs].filter(a => {
    const k = a.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return { exe, args: finalArgs, isMsi: false }
}

function needsElevation(uninstallString) {
  return /unins|uninstall|\.exe/i.test(uninstallString || '') && !/user|local/i.test(uninstallString || '')
}

/**
 * 卸载指定环境
 * @param {string} envId
 * @param {object} detection 检测结果
 * @param {(evt:object)=>void} emit
 */
async function uninstall(envId, detection, emit) {
  const env = ENV_MAP[envId]
  if (!env) throw new Error('未知环境')

  // 绿色版: 手动删除目录 + 清理 PATH
  if (env.uninstall?.strategy === 'manual') {
    return manualUninstall(env, detection, emit)
  }

  // Rust: rustup self uninstall
  if (env.uninstall?.strategy === 'rustup-self') {
    return rustupUninstall(env, detection, emit)
  }

  const str = detection?.quietUninstallString || detection?.uninstallString
  if (!str) {
    throw new Error(
      `${env.name} 未在注册表中找到卸载信息，可能为绿色版或已损坏。` +
      `可手动删除目录：${detection?.installDir || '未知路径'}`
    )
  }

  const parsed = parseUninstallString(str)
  if (!parsed) throw new Error(`无法解析卸载命令: ${str}`)

  emit({
    phase: 'uninstall',
    message: `正在卸载 ${env.name}…`,
    command: `${parsed.exe} ${parsed.args.join(' ')}`
  })

  const admin = needsElevation(str)
  let res
  if (admin) {
    res = await elevate(parsed.exe, parsed.args)
  } else {
    res = await execAsync(parsed.exe, parsed.args, { timeout: 20 * 60 * 1000 })
  }

  const ok = res.code === 0 || res.code === 3010 || res.code === 1641 || res.code === 1605
  emit({
    phase: ok ? 'done' : 'error',
    message: ok ? `${env.name} 卸载完成` : `${env.name} 卸载未完全成功（退出码 ${res.code}）`,
    exitCode: res.code
  })

  if (!ok) throw new Error(`卸载返回码 ${res.code}，请检查程序是否需要手动关闭`)

  // 清理可能残留的 PATH 条目
  if (detection?.installDir) {
    await cleanupPathEntry(detection.installDir).catch(() => {})
  }

  return { ok: true }
}

/** 绿色版卸载: 删除安装目录并清理 PATH */
async function manualUninstall(env, detection, emit) {
  const dir = detection?.installDir
  if (!dir) throw new Error('无法定位安装目录，请手动删除')

  emit({ phase: 'uninstall', message: `正在删除 ${dir}…` })

  if (fs.existsSync(dir)) {
    const admin = !dir.toUpperCase().startsWith('C:\\USERS')
    try {
      if (admin) {
        await execAsync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Remove-Item -LiteralPath "${dir}" -Recurse -Force -ErrorAction Stop`
        ], { timeout: 10 * 60 * 1000 })
      } else {
        await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3 })
      }
    } catch (e) {
      // 提权重试
      await elevate('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Remove-Item -LiteralPath "${dir}" -Recurse -Force`
      ])
    }
  }

  const cleaned = await cleanupPathEntry(dir)
  emit({ phase: 'done', message: `${env.name} 已移除${cleaned ? '，并清理了 PATH 条目' : ''}` })
  return { ok: true, pathCleaned: cleaned }
}

/** Rust 官方卸载 */
async function rustupUninstall(env, detection, emit) {
  emit({ phase: 'uninstall', message: '正在通过 rustup 移除所有工具链…' })
  const home = path.join(require('os').homedir(), '.cargo', 'bin', 'cargo.exe')
  const res = await fs.promises.stat(home).then(() => execAsync(home, ['self', 'uninstall', '-y'], { timeout: 10 * 60 * 1000 }))
    .catch(() => ({ code: 1, log: '未找到 cargo' }))

  const ok = res.code === 0
  emit({ phase: ok ? 'done' : 'error', message: ok ? 'Rust 已卸载' : 'Rust 卸载失败，请手动删除 ~/.cargo 与 ~/.rustup 目录' })
  if (!ok) throw new Error('Rust 卸载失败，可手动删除 %USERPROFILE%\\.cargo 与 %USERPROFILE%\\.rustup')

  await cleanupPathEntry(path.join(require('os').homedir(), '.cargo', 'bin'))
  return { ok: true }
}

/** 从用户级 PATH 中移除指向该目录的条目 */
async function cleanupPathEntry(dir) {
  if (!dir) return false
  const snapshot = await envvars.readAll()
  const key = String(dir).toLowerCase().replace(/\//g, '\\').replace(/\\bin$/, '')

  const userHits = snapshot.user.path.filter(e => {
    const k = e.toLowerCase().replace(/\//g, '\\')
    return k === key || k === key + '\\bin' || k.startsWith(key + '\\')
  })

  if (userHits.length) {
    const next = snapshot.user.path.filter(e => !userHits.includes(e))
    await envvars.savePath('user', next)
    return true
  }
  return false
}

module.exports = { uninstall, parseUninstallString, cleanupPathEntry }