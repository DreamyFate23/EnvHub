/**
 * 环境检测引擎
 * 三层探测: 1) PATH 可执行文件  2) 注册表 Uninstall  3) 标准安装目录扫描
 */
const { execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { ENVIRONMENTS } = require('./catalog/environments')

/* ---------------- 工具函数 ---------------- */

function expandEnv(str) {
  if (!str) return str
  return str
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '')
    .replace(/%PROGRAMFILES%/gi, process.env.ProgramFiles || '')
    .replace(/%PROGRAMFILES\(X86\)%/gi, process.env['ProgramFiles(x86)'] || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
    .replace(/%USERPROFILE%/gi, os.homedir())
}

function exists(p) {
  try { return fs.existsSync(p) } catch { return false }
}

/** 展开目录通配符，如 C:\tools\gradle\*\bin */
function expandGlob(pattern) {
  const p = expandEnv(pattern)
  if (!p.includes('*')) return exists(p) ? [p] : []

  const segs = p.split(/[\\/]/)
  let roots = [segs[0] || 'C:']
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i]
    const next = []
    for (const r of roots) {
      if (!seg.includes('*')) { next.push(path.join(r, seg)); continue }
      try {
        const entries = fs.readdirSync(r).sort().reverse()
        for (const e of entries) {
          const full = path.join(r, e)
          try { if (fs.statSync(full).isDirectory()) next.push(full) } catch {}
        }
      } catch {}
    }
    roots = next
  }
  return roots
}

/**
 * 执行版本探测命令
 *
 * 两个坑:
 * 1. 版本模板里的 $BIN 两侧可能已带引号 (如 '"$BIN" --version')，
 *    若再包一层会变成 ""C:\path\prog.exe""，导致 spawn ENOENT。
 * 2. 不能用 split(' ')[0] 取可执行文件 —— 路径含空格时会被截断。
 *    必须按引号边界解析。
 */
function runVersionCmd(binPath, cmdTemplate, timeout = 20000) {
  return new Promise(resolve => {
    if (!cmdTemplate) return resolve(null)

    // $BIN 已被引号包裹时直接替换，否则补上引号以容纳空格路径
    const command = cmdTemplate.replace('$BIN', (m, offset) => {
      const before = cmdTemplate.slice(0, offset)
      const quoted = before.endsWith('"') && cmdTemplate[offset + 4] === '"'
      return quoted ? binPath : `"${binPath}"`
    })

    const isBatch = /\.(bat|cmd)$/i.test(binPath)

    if (isBatch) {
      // 批处理必须经由 cmd.exe 执行
      execFile('cmd.exe', ['/d', '/s', '/c', `call ${command}`], {
        timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
      }, (err, stdout, stderr) => {
        resolve(`${stdout || ''}\n${stderr || ''}`.trim() || null)
      })
      return
    }

    // 从 "C:\path with space\prog.exe" --version 中分离出 exe 与参数
    const m = command.match(/^"([^"]+)"\s*([\s\S]*)$/)
    const exe = m ? m[1] : command.split(/\s+/)[0]
    const args = m ? (m[2].trim().split(/\s+/).filter(Boolean)) : command.split(/\s+/).slice(1)

    execFile(exe, args, {
      timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
    }, (err, stdout, stderr) => {
      const out = `${stdout || ''}\n${stderr || ''}`.trim()
      resolve(out || null)
    })
  })
}

function extractVersion(output, regexStr) {
  if (!output || !regexStr) return null
  const m = output.match(new RegExp(regexStr))
  return m ? m[1] : null
}

/** 比较版本号: a > b 返回正数 */
function compareVersions(a, b) {
  if (!a || !b) return 0
  const pa = String(a).split(/[.\-+]/).map(x => parseInt(x, 10) || 0)
  const pb = String(b).split(/[.\-+]/).map(x => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

/* ---------------- 探测实现 ---------------- */

/** 扫描 PATH 中所有目录，返回 可执行文件名 -> 完整路径 的映射 */
function scanPathExecutables() {
  const raw = process.env.PATH || ''
  const dirs = raw.split(';').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
  const map = {}
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)

  for (const d of dirs) {
    const real = expandEnv(d)
    if (!exists(real)) continue
    let entries = []
    try { entries = fs.readdirSync(real) } catch { continue }
    for (const f of entries) {
      const ext = path.extname(f).toUpperCase()
      if (!exts.includes(ext)) continue
      const stem = path.basename(f, ext).toLowerCase()
      if (!map[stem]) map[stem] = path.join(real, f)
    }
  }
  return map
}

/**
 * 读取注册表 Uninstall 节点（64 + 32 位 + 用户级），返回已注册程序列表
 * 使用 PowerShell + ConvertTo-Json，比 reg query /s 快一个数量级
 */
function queryUninstallRegistry() {
  const { execFile } = require('child_process')
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$out = New-Object System.Collections.ArrayList
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  foreach ($k in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    if (-not $p.DisplayName) { continue }
    [void]$out.Add([PSCustomObject]@{
      key                 = $k.Name
      displayname         = [string]$p.DisplayName
      displayversion      = [string]$p.DisplayVersion
      uninstallstring     = [string]$p.UninstallString
      quietuninstallstring= [string]$p.QuietUninstallString
      installlocation     = [string]$p.InstallLocation
      publisher           = [string]$p.Publisher
    })
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`

  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 45000, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve([])
        const text = String(stdout).trim()
        if (!text || text === 'null' || text.length < 3) return resolve([])
        try {
          const parsed = JSON.parse(text)
          return resolve(Array.isArray(parsed) ? parsed : [parsed])
        } catch {
          return resolve([])
        }
      }
    )
  })
}

let pathCache = null
let registryCache = null
let registryPromise = null

function getPathCache() {
  if (!pathCache) pathCache = scanPathExecutables()
  return pathCache
}

function getRegistryCache() {
  if (!registryPromise) {
    registryPromise = queryUninstallRegistry().then(r => {
      registryCache = r
      return r
    })
  }
  return registryPromise
}

function clearDetectionCache() {
  pathCache = null
  registryCache = null
  registryPromise = null
}

/**
 * 在注册表卸载项中为某个环境找到唯一匹配的记录
 * 三级匹配策略，避免误匹配：
 *   1. env.registries 中声明的精确注册表键
 *   2. env.registryMatch —— 锚定的正则，须匹配整个 DisplayName
 *   3. 名称全词匹配（要求名称边界，避免子串串台）
 */
function matchRegistryEntry(env, registry) {
  // 1. 精确键匹配
  if (env.registries?.length) {
    for (const rk of env.registries) {
      const hit = registry.find(r => r.key && r.key.toUpperCase() === rk.toUpperCase())
      if (hit) return hit
    }
  }

  // 2. 声明式正则匹配（最可靠，优先于名称推断）
  if (env.registryMatch) {
    const re = new RegExp(env.registryMatch, 'i')
    const hit = registry.find(r => r.displayname && re.test(r.displayname))
    if (hit) return hit
  }

  // 3. 全词名称匹配：DisplayName 必须包含环境名的每个词作为独立词
  const words = (env.name || '')
    .replace(/[^\w\u4e00-\u9fa5.+\s]/g, ' ')
    .split(/[\s/]+/)
    .filter(w => w.length > 1 && !/^(sdk|server|hub|cli)$/i.test(w))

  if (words.length) {
    const hit = registry.find(r => {
      const dn = (r.displayname || '').toLowerCase()
      if (!dn) return false
      return words.every(w => new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(dn))
    })
    if (hit) return hit
  }

  return null
}

/** 检测单个环境 */
async function detectOne(env) {
  const pathMap = getPathCache()
  const registry = await getRegistryCache()

  const foundBins = []
  for (const b of env.binaries || []) {
    const hit = pathMap[b.toLowerCase()]
    if (hit && exists(hit)) foundBins.push(hit)
  }

  // PATH 未命中则扫描标准安装目录
  let matchedPathTemplate = null
  if (foundBins.length === 0 && env.paths?.length) {
    for (const p of env.paths) {
      for (const full of expandGlob(p)) {
        if (exists(full)) { foundBins.push(full); matchedPathTemplate = p; break }
      }
    }
  }

  // 匹配注册表条目
  // 优先级: 精确 key > 版本号专用正则 > 名称正则
  // 不使用宽松的 includes —— 会让 "Visual Studio Code" 误命中
  // "Visual Studio Build Tools"，导致多个环境共享同一条记录
  const regHit = matchRegistryEntry(env, registry)

  let version = null
  let exePath = foundBins[0] || null
  let versionProbeFailed = false

  // 优先级 1: 直接执行可执行文件获取版本 —— 最准确
  if (foundBins.length) {
    const out = await runVersionCmd(foundBins[0], env.versionCmd)
    version = extractVersion(out, env.versionRegex)
    // 执行了命令但提取不出版本，说明这个可执行文件不是本环境
    // (例如只有 .NET Runtime 时 dotnet.exe 存在但 --version 会报错)。
    // 注意: 仅对显式配置了 versionCmd 的环境生效 —— 无法探测版本
    // 不代表未安装(如 VS Build Tools 无统一版本命令)
    if (!version && env.versionCmd && env.versionRegex) versionProbeFailed = true
  }

  // 优先级 2: 注册表 DisplayVersion
  // 需校验格式：注册表里常见 "3.12.8150.0" 这类四段构建号，
  // 会让版本对比失效，因此只接受两到三段的语义版本
  //
  // 重要: 若可执行文件存在但版本探测失败（如只装了 .NET Runtime
  // 而没有 SDK），绝不能回退到注册表值 —— 那会拿到
  // "64.28.16731" 这类构建号，误导用户认为已安装 SDK。
  if (!version && !versionProbeFailed && regHit?.displayversion && isPlausibleVersion(regHit.displayversion)) {
    version = regHit.displayversion
  }

  // 只有可执行文件存在、却没有匹配到任何注册表记录时才算已安装。
  // 否则会出现"有 dotnet.exe 就认为装了 SDK"这类误报。
  //
  // 若可执行文件存在但版本探测失败，说明该 exe 属于其它组件
  // (典型: 只装了 .NET Runtime，没有 SDK)，此时不算已安装。
  // 但这条规则只对显式声明 strictBinary 的环境生效 —— 部分环境
  // 的版本命令在特定环境下会失败(如 Docker Desktop 需 WSL2 就绪)，
  // 对它们误判会造成漏报。
  const strict = env.strictBinary !== false && !!env.versionCmd && !env.tolerateProbeFailure
  const installed = foundBins.length > 0
    ? (strict ? !versionProbeFailed : true)
    : !!regHit

  // 安装目录推导优先级:
  //   1. 注册表记录(最准确)
  //   2. 环境自带的 installDirDefault(绿色版，路径已知)
  //   3. 从命中的 paths 模板反推目录
  //   4. 从 exe 路径上溯两层(bin/ 目录的上一级)
  let installDir = regHit?.installlocation || null
  if (!installDir) {
    installDir = env.installer?.installDirDefault?.replace(/\{\{\w+\}\}/g, '') || null
  }
  if (!installDir && matchedPathTemplate) {
    installDir = matchedPathTemplate.replace(/[\\/][^\\/]+$/, '')
  }
  if (!installDir && exePath) {
    installDir = path.dirname(path.dirname(exePath))
  }

  return {
    id: env.id,
    installed,
    version,
    exePath,
    versionProbeFailed,
    installDir: installDir || null,
    registryKey: regHit?.key || env.uninstall?.key || null,
    uninstallString: regHit?.uninstallstring || null,
    quietUninstallString: regHit?.quietuninstallstring || null,
    source: foundBins.length ? (regHit ? 'both' : 'path') : (regHit ? 'registry' : null)
  }
}

/**
 * 校验版本号是否为可用的语义版本
 * 拒绝: 10.0.40219 (四段构建号)、空值、非数字
 * 接受: 3.12.8 / 22.2 / 1.2.3-beta / 8.4.0
 */
function isPlausibleVersion(v) {
  if (!v) return false
  const s = String(v).trim().replace(/^v/i, '')
  const m = s.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return false

  // 四段及以上视为构建号，不可用作版本对比
  const segments = s.split(/[.\-+]/).filter(x => /^\d+$/.test(x))
  if (segments.length > 3) return false

  // 主版本号明显异常时拒绝（如某些程序误报 10.0.x）
  const major = parseInt(m[1], 10)
  if (major > 99) return false

  return true
}

/** 检测全部环境 */
async function detectAll(onProgress) {
  const results = []
  for (let i = 0; i < ENVIRONMENTS.length; i++) {
    const env = ENVIRONMENTS[i]
    try {
      const r = await detectOne(env)
      results.push(r)
      onProgress?.({ current: i + 1, total: ENVIRONMENTS.length, id: env.id, name: env.name })
    } catch (e) {
      results.push({
        id: env.id, installed: false, version: null, exePath: null,
        installDir: null, registryKey: null, uninstallString: null,
        quietUninstallString: null, source: null, error: e.message
      })
    }
  }
  return results
}

/* ---------------- 远端最新版本 ---------------- */

// HTTP 客户端独立成模块，避免与 catalog 形成循环依赖
const { httpGet, httpGetSafe, isCertError } = require('./http')

/**
 * 获取单个环境的官方最新版本
 * @param {object} env 环境定义
 * @returns {Promise<string|null>} 版本号；'latest' 表示该环境只跟随官方最新版
 */
async function fetchLatestVersion(env) {
  const cfg = env.latest
  if (!cfg) return null
  if (cfg.type === 'static') return cfg.value === 'latest' ? 'latest' : cfg.value

  const url = cfg.url.replace(/\{\{channel\}\}/g, 'lts')

  try {
    // httpGetSafe 内部已处理证书降级
    const { text, insecure } = await httpGetSafe(url, 20000)
    if (insecure) console.warn(`[latest] ${env.id}: 已降级为不校验证书`)

    if (cfg.type === 'json' || cfg.type === 'api') return cfg.pick(JSON.parse(text))
    if (cfg.type === 'json2') {
      // 两段式查询: transform 拿到索引后自行发起第二次请求
      return await cfg.transform(JSON.parse(text))
    }
    if (cfg.type === 'html' || cfg.type === 'text') {
      // transformAll 接收完整文本，适合需要扫描全部匹配项的场景
      // (如 Python FTP 目录里选出最高的版本)
      if (cfg.transformAll) return cfg.transformAll(text)
      const m = text.match(cfg.regex)
      if (!m) return null
      // 部分接口的捕获组是分段数字 (如 7z2603 -> "26","03")，
      // 需要 transform 拼装成标准版本号
      return cfg.transform ? cfg.transform(m) : m[1]
    }
    return null
  } catch (e) {
    if (!cfg.optional) console.warn(`[latest] ${env.id}: ${e.message}`)
    return null
  }
}

/** 检查所有环境的更新情况 */
async function checkUpdates(detections, onProgress) {
  const out = []
  for (const d of detections.filter(x => x.installed)) {
    const env = ENVIRONMENTS.find(e => e.id === d.id)
    if (!env) continue
    const latest = await fetchLatestVersion(env)
    let hasUpdate = false
    if (latest && latest !== 'latest' && d.version) {
      hasUpdate = compareVersions(latest, d.version) > 0
    }
    out.push({ id: d.id, current: d.version, latest, hasUpdate })
    onProgress?.({ id: d.id, name: env.name, hasUpdate, latest })
  }
  return out
}

module.exports = {
  detectAll,
  detectOne,
  checkUpdates,
  fetchLatestVersion,
  clearDetectionCache,
  compareVersions,
  isPlausibleVersion,
  matchRegistryEntry,
  httpGet,
  expandGlob,
  expandEnv,
  exists
}