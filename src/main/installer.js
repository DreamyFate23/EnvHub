/**
 * 安装 / 更新引擎
 * 按 installer.strategy 分派不同策略:
 *   msi           msiexec /i /qn
 *   exe           官方静默参数 (NSIS /S, Inno /VERYSILENT, Burn --quiet)
 *   zip           免安装解压 + 可选写入 PATH
 *   rustup        rustup-init 官方安装器
 *   bootstrapper  VS 安装引导程序
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, execFile } = require('child_process')
const { download, probeSize, humanSize } = require('./downloader')
const { ENV_MAP } = require('./catalog/environments')
const { execAsync, extractZip, elevate } = require('./utils')

const STAGING = path.join(os.tmpdir(), 'envhub-downloads')

function renderTemplate(tpl, ctx) {
  if (!tpl) return tpl
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? '')
}

function renderArgs(args, ctx) {
  return (args || []).map(a => renderTemplate(a, ctx))
}

/**
 * 执行安装
 * @param {object} env 环境定义
 * @param {string} version 目标版本 (latest 表示由用户确认后的具体版本)
 * @param {(evt:object)=>void} emit 进度事件回调
 */
async function install(env, version, emit) {
  const def = env.installer
  if (!def) throw new Error(`${env.name} 未配置安装策略`)

  const target = version && version !== 'latest'
    ? version
    : await resolveVersionForInstall(env, emit)
  if (!target) throw new Error(`无法确定 ${env.name} 的安装版本，请手动指定`)

  emit({ phase: 'prepare', message: `准备安装 ${env.name} ${target}` })

  const installDir = def.installDirDefault
    ? renderTemplate(def.installDirDefault, { version: target, installDir: def.installDirDefault })
    : path.join('C:\\tools', env.id)

  const ctx = {
    version: target,
    installDir,
    lang: 'zh-CN',
    file: '',
    exeName: def.exeName ? renderTemplate(def.exeName, { version: target }) : null
  }

  await fs.promises.mkdir(STAGING, { recursive: true })

  // ---------------- 无需下载的直装型 (rustup / bootstrapper) ----------------
  if (def.strategy === 'rustup' || def.strategy === 'bootstrapper') {
    const url = renderTemplate(def.urlTemplate, ctx)
    const fname = ctx.exeName || path.basename(new URL(url).pathname)
    const file = path.join(STAGING, `${env.id}-${fname}`)
    emit({ phase: 'download', message: `正在下载 ${env.name} 安装器…` })
    await fetchAndDownload(url, file, emit)
    return runInstaller(env, def, ctx, file, emit)
  }

  // ---------------- 需要下载的策略 ----------------
  const attempts = [def, def.fallback].filter(Boolean)

  let lastError = null
  for (const strategy of attempts) {
    try {
      const url = renderTemplate(strategy.urlTemplate, ctx)
      const fname = ctx.exeName || strategy.exeName || path.basename(new URL(url).pathname) || `${env.id}.bin`
      const file = path.join(STAGING, `${env.id}-${target}-${fname}`)

      if (await fs.promises.stat(file).then(s => s.size > 0).catch(() => false)) {
        emit({ phase: 'download', message: '使用已缓存的安装包', percent: 100 })
      } else {
        await fetchAndDownload(url, file, emit)
      }

      return await runInstaller(env, { ...strategy, ...def }, ctx, file, emit)
    } catch (e) {
      lastError = e
      emit({ phase: 'fallback', message: `该地址不可用，尝试备用源…` })
    }
  }
  throw lastError || new Error('所有下载源均失败')
}

/** 解析实际要安装的版本号 */
async function resolveVersionForInstall(env, emit) {
  const { fetchLatestVersion } = require('./detector')
  emit({ phase: 'resolve', message: '正在查询最新版本…' })
  const v = await fetchLatestVersion(env)
  if (v && v !== 'latest') return v
  throw new Error('未能从官方获取最新版本号')
}

/** 执行具体的安装命令 */
async function runInstaller(env, def, ctx, file, emit) {
  const args = renderArgs(def.args, { ...ctx, file })
  const needsAdmin = !!def.adminRequired

  emit({
    phase: 'install',
    message: needsAdmin ? '正在以管理员权限安装（将弹出 UAC 授权）…' : '正在静默安装，请稍候…'
  })

  const exePath = def.strategy === 'msi' ? 'msiexec.exe' : file
  const cmd = def.strategy === 'msi' ? exePath : `"${file}"`
  const cmdArgs = def.strategy === 'msi' ? args : args.map(a => /[\s"]/.test(a) ? `"${a}"` : a)

  let result
  if (needsAdmin) {
    // 通过 PowerShell Start-Process -Verb RunAs 触发 UAC 提权
    result = await elevate(exePath, cmdArgs)
  } else {
    result = await execAsync(exePath, cmdArgs, { timeout: 30 * 60 * 1000 })
  }

  const code = result.code
  const ok = code === 0 || code === 3010 || code === 1641

  emit({
    phase: ok ? 'done' : 'error',
    message: ok ? `${env.name} 安装完成` : `${env.name} 安装失败（退出码 ${code}）`,
    exitCode: code,
    log: result.log
  })

  if (!ok) throw new Error(`安装失败，退出码 ${code}`)
  return { ok: true, code }
}

/* ---------------- 绿色版 (zip) 安装 ---------------- */
async function installPortable(env, version, emit) {
  const def = env.installer
  const { fetchLatestVersion } = require('./detector')

  const target = version && version !== 'latest' ? version : await fetchLatestVersion(env)
  if (!target) throw new Error(`无法确定 ${env.name} 的版本号`)

  const installDir = path.isAbsolute(def.installDirDefault || '')
    ? def.installDirDefault
    : path.join('C:\\tools', env.id)

  const ctx = { version: target, installDir }
  const url = renderTemplate(def.urlTemplate, ctx)
  const fname = path.basename(new URL(url).pathname) || `${env.id}.zip`
  const file = path.join(STAGING, `${env.id}-${target}-${fname}`)

  emit({ phase: 'download', message: `正在下载 ${env.name} ${target}…` })
  await fetchAndDownload(url, file, emit)

  emit({ phase: 'install', message: `正在解压到 ${installDir}…` })
  await fs.promises.mkdir(installDir, { recursive: true })

  // 传入期望的主文件名做校验，避免"解压失败却报告成功"
  const extractedTo = await extractZip(file, installDir, def.targetName)

  // 定位最终目录:
  //   innerFolder   —— 归档内含一层同名目录 (如 flutter)
  //   targetSubdir  —— 主文件位于子目录中 (如 bun-windows-x64/deno)
  //   否则即为 installDir 本身
  let finalDir = extractedTo
  if (def.innerFolder) {
    const p = path.join(installDir, def.innerFolder)
    if (fs.existsSync(p)) finalDir = p
  } else if (def.targetName && def.targetSubdir) {
    const p = path.join(installDir, def.targetSubdir)
    if (fs.existsSync(p)) finalDir = p
  }

  // 最终校验：主文件必须真实存在
  if (def.targetName) {
    const exePath = path.join(finalDir, def.targetName)
    if (!fs.existsSync(exePath)) {
      throw new Error(`解压后未找到 ${def.targetName}（期望位置: ${exePath}）`)
    }
    emit({ phase: 'install', message: `已校验主程序: ${exePath}` })
  }

  emit({ phase: 'install', message: `解压完成: ${finalDir}` })
  emit({ phase: 'done', message: `${env.name} ${target} 已安装到 ${finalDir}`, installDir: finalDir })

  return { ok: true, installDir: finalDir, version: target, pathHint: def.pathEntry ? path.join(finalDir, def.pathEntry) : finalDir }
}

async function fetchAndDownload(url, dest, emit, label) {
  const { download } = require('./downloader')
  const { probeSize, humanSize } = require('./downloader')

  if (await fs.promises.stat(dest).then(s => s.size > 0).catch(() => false)) {
    emit({ phase: 'download', message: '使用已缓存的安装包', percent: 100 })
    return
  }

  const size = await probeSize(url)
  emit({
    phase: 'download',
    message: `正在下载 ${humanSize(size)}…`,
    expectedSize: size,
    expectedSizeText: humanSize(size)
  })

  try {
    await download(url, dest, p => emit({ phase: 'download', ...p }))
  } catch (e) {
    // 企业内网/代理常见自签证书问题，降级为不校验证书重试一次
    if (/certificate|SSL|TLS|PROTOCOL/i.test(e.message || '')) {
      emit({ phase: 'warn', message: '检测到证书校验失败，正在以不校验模式重试…' })
      await download(url, dest, p => emit({ phase: 'download', ...p }), true)
    } else {
      throw e
    }
  }
}

module.exports = { install, installPortable, renderTemplate, renderArgs, STAGING, fetchAndDownload }