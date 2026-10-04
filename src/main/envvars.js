/**
 * 环境变量管理器
 * 支持用户级(HKCU)与系统级(HKLM)读写、备份、还原、PATH 条目增删排序
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execAsync, broadcastEnvChange } = require('./utils')
const { elevate } = require('./utils')

const BACKUP_DIR = path.join(os.homedir(), '.envhub', 'backups')
const HKCU = 'HKCU\\Environment'
const HKLM = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'

/* ---------------- 原始值读写 ---------------- */

/** 读取单个注册表值（通过 PowerShell，避开 reg.exe） */
function regQuery(regPath, name) {
  return new Promise(resolve => {
    const ps = `$ErrorActionPreference='SilentlyContinue'; $v = (Get-ItemProperty -LiteralPath '${regPath.replace(/'/g, "''")}' -Name '${name}' -ErrorAction SilentlyContinue).'${name}'; if ($v -ne $null) { Write-Output $v }`
    execAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 15000 }
    ).then(res => {
      if (res.code !== 0) return resolve(null)
      const out = res.stdout.trim()
      resolve(out || null)
    })
  })
}

/** 写入注册表值（用户级，无需提权） */
function regSet(regPath, name, value, type = 'ExpandString') {
  const ps = `$ErrorActionPreference='Stop'; `
  const psType = type === 'ExpandString' ? '[Microsoft.Win32.RegistryValueKind]::ExpandString' : '[Microsoft.Win32.RegistryValueKind]::String'
  const psFn = type === 'ExpandString' ? 'Set-ItemProperty' : 'New-ItemProperty'
  const script = `$ErrorActionPreference='Stop'; `
    + `${type === 'ExpandString' ? 'Set-ItemProperty' : 'New-ItemProperty'} -LiteralPath '${regPath.replace(/'/g, "''")}' -Name '${name}' -Value '${value.replace(/'/g, "''")}' -Type ${psType} -Force | Out-Null; Write-Output 'OK'`

  return execAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 20000 }
  )
}

/** 提权写入注册表值（系统级） */
function regSetElevated(regPath, name, value, type = 'ExpandString') {
  return new Promise((resolve, reject) => {
    const psType = type === 'ExpandString' ? 'ExpandString' : 'String'
    const inner = `$ErrorActionPreference='Stop'; `
      + `${type === 'ExpandString' ? 'Set-ItemProperty' : 'New-ItemProperty'} -LiteralPath '${regPath.replace(/'/g, "''")}' -Name '${name}' -Value '${value.replace(/'/g, "''")}' -Type ${psType} -Force | Out-Null`

    const script = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',"${inner.replace(/"/g, '\\"')}" -Verb RunAs -Wait`
    execAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 90000 }
    ).then(res => {
      if (res.code === 0) resolve({ code: 0, log: '提权写入成功' })
      else reject(new Error(`提权写入 ${name} 失败，可能已取消授权`))
    }).catch(reject)
  })
}

/* ---------------- PATH 处理 ---------------- */

const SEP = ';'

function splitPath(value) {
  if (!value) return []
  return value.split(SEP).map(s => s.trim()).filter(Boolean)
}

function joinPath(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    const t = e.trim()
    if (!t) continue
    const k = t.toLowerCase().replace(/\//g, '\\')
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out.join(SEP)
}

/* ---------------- 对外 API ---------------- */

/** 读取完整环境变量快照 */
async function readAll() {
  const [userPathRaw, sysPathRaw] = await Promise.all([
    regQuery(HKCU, 'Path'),
    regQuery(HKLM, 'Path')
  ])

  // 展开未展开的 %SystemRoot% 等变量以便展示
  const expand = v => (v || '').replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m)

  const userEntries = splitPath(userPathRaw).map(expand)
  const sysEntries = splitPath(sysPathRaw).map(expand)

  // 其他常用变量
  const extras = {}
  for (const n of ['JAVA_HOME', 'GOROOT', 'GOPATH', 'MAVEN_HOME', 'GRADLE_HOME', 'NODE_PATH', 'PYTHONHOME', 'CARGO_HOME', 'RUSTUP_HOME', 'GIT_HOME', 'CMAKE_HOME']) {
    const v = await regQuery(HKCU, n) || await regQuery(HKLM, n)
    if (v) extras[n] = v
  }

  // 当前进程实际生效的 PATH（合并后）
  const merged = new Set([...sysEntries, ...userEntries].map(e => e.toLowerCase()))
  const effective = (process.env.PATH || '').split(SEP).map(s => s.trim()).filter(Boolean)

  return {
    user: { path: userEntries, raw: userPathRaw || '' },
    system: { path: sysEntries, raw: sysPathRaw || '' },
    extras,
    effectiveCount: merged.size,
    processPathCount: effective.length,
    isAdmin: await isAdmin()
  }
}

async function isAdmin() {
  const r = await execAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive',
    '-Command', "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
  ], { timeout: 10000 })
  return r.stdout.trim().toLowerCase() === 'true'
}

/** 保存 PATH（用户级或系统级） */
async function savePath(scope, entries, { elevateIfNeeded = true } = {}) {
  const value = joinPath(entries)
  const regPath = scope === 'system' ? HKLM : HKCU

  let res = await regSet(regPath, 'Path', value)
  if (res.code !== 0 && scope === 'system' && elevateIfNeeded) {
    res = await regSetElevated(regPath, 'Path', value)
  }
  if (res.code !== 0) throw new Error(`保存 PATH 失败: ${res.stderr || res.stdout}`)

  await broadcastEnvChange()
  return { ok: true, scope, entries: splitPath(value) }
}

/** 备份 PATH */
async function backup(tag = 'manual') {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true })
  const snapshot = await readAll()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(BACKUP_DIR, `path-${stamp}-${tag}.json`)
  await fs.promises.writeFile(file, JSON.stringify({ savedAt: new Date().toISOString(), ...snapshot }, null, 2), 'utf8')
  return { file, savedAt: new Date().toISOString() }
}

/** 列出备份 */
async function listBackups() {
  try {
    const files = await fs.promises.readdir(BACKUP_DIR)
    const items = []
    for (const f of files.filter(x => x.endsWith('.json'))) {
      const full = path.join(BACKUP_DIR, f)
      const stat = await fs.promises.stat(full)
      let meta = {}
      try {
        const j = JSON.parse(await fs.promises.readFile(full, 'utf8'))
        meta = { userCount: j.user?.path?.length, systemCount: j.system?.path?.length, savedAt: j.savedAt }
      } catch {}
      items.push({ file: full, name: f, size: stat.size, mtime: stat.mtime.toISOString(), ...meta })
    }
    return items.sort((a, b) => b.mtime.localeCompare(a.mtime))
  } catch { return [] }
}

/** 还原备份 */
async function restore(file) {
  const j = JSON.parse(await fs.promises.readFile(file, 'utf8'))
  await savePath('user', j.user?.path || [])
  if (j.system?.path?.length) {
    await savePath('system', j.system.path).catch(e => {
      throw new Error(`用户级已还原，但系统级还原失败（需要管理员权限）: ${e.message}`)
    })
  }
  return { ok: true }
}

/** 判断某目录是否已在 PATH 中 */
async function isInPath(dir, scope = 'user') {
  const snapshot = await readAll()
  const entries = (scope === 'system' ? snapshot.system.path : snapshot.user.path).map(e => e.toLowerCase().replace(/\//g, '\\'))
  return entries.includes(String(dir).toLowerCase().replace(/\//g, '\\'))
}

/** 添加目录到 PATH */
async function addToPath(dir, scope = 'user') {
  const snapshot = await readAll()
  const current = scope === 'system' ? snapshot.system.path : snapshot.user.path
  if (isInPathSync(current, dir)) return { ok: true, added: false, reason: '已存在于 PATH 中' }
  const next = [...current, dir]
  await savePath(scope, next)
  return { ok: true, added: true, entries: next }
}

/** 从 PATH 移除指定条目 */
async function removeFromPath(dir, scope = 'user') {
  const snapshot = await readAll()
  const key = String(dir).toLowerCase().replace(/\//g, '\\')
  const next = (scope === 'system' ? snapshot.system.path : snapshot.user.path)
    .filter(e => e.toLowerCase().replace(/\//g, '\\') !== key)
  await savePath(scope, next)
  return { ok: true, entries: next }
}

function isInPathSync(entries, dir) {
  const key = String(dir).toLowerCase().replace(/\//g, '\\')
  return entries.some(e => e.toLowerCase().replace(/\//g, '\\') === key)
}

/** 设置自定义环境变量 */
async function setVariable(name, value, scope = 'user') {
  const regPath = scope === 'system' ? HKLM : HKCU
  let res = await regSet(regPath, name, value, 'REG_SZ')
  if (res.code !== 0 && scope === 'system') res = await regSetElevated(regPath, name, value, 'REG_SZ')
  if (res.code !== 0) throw new Error(`设置 ${name} 失败`)
  await broadcastEnvChange()
  return { ok: true }
}

async function removeVariable(name, scope = 'user') {
  const regPath = scope === 'system' ? HKLM : HKCU
  const ps = `Remove-ItemProperty -LiteralPath '${regPath.replace(/'/g, "''")}' -Name '${name}' -Force -ErrorAction SilentlyContinue; Write-Output 'OK'`
  await execAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { timeout: 15000 }
  )
  await broadcastEnvChange()
  return { ok: true }
}

module.exports = {
  readAll,
  savePath,
  backup,
  listBackups,
  restore,
  addToPath,
  removeFromPath,
  isInPath,
  setVariable,
  removeVariable,
  isAdmin,
  splitPath,
  joinPath,
  BACKUP_DIR
}