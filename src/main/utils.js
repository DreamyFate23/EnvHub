/**
 * 通用工具函数
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, exec } = require('child_process')

/** 执行命令并捕获输出 */
function execAsync(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, {
      timeout: opts.timeout || 120000,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(opts.env || {}) }
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        log: `${stdout || ''}${stderr || ''}`.trim(),
        error: err ? err.message : null
      })
    })
  })
}

/** 通过 PowerShell Start-Process -Verb RunAs 触发 UAC 提权执行 */
function elevate(exe, args) {
  return new Promise((resolve, reject) => {
    const quotedArgs = args.map(a => `"${String(a).replace(/"/g, '""')}"`).join(' ')
    const escapedExe = `"${exe.replace(/"/g, '""')}"`
    const ps = `Start-Process -FilePath ${escapedExe} -ArgumentList ${quotedArgs} -Verb RunAs -Wait -PassThru | Select-Object -ExpandProperty ExitCode`

    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`,
      { timeout: 40 * 60 * 1000, windowsHide: false },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error(`提权执行失败: ${stderr || err.message}`))
        const code = parseInt(String(stdout).trim(), 10)
        resolve({ code: isNaN(code) ? 0 : code, log: String(stdout).trim() })
      }
    )
  })
}

/**
 * 解压 zip
 * 优先用 .NET ZipFile（比 Expand-Archive 快且不受编码影响），
 * 解压到临时目录后再移动到目标位置，最后校验主文件是否存在。
 */
async function extractZip(zipFile, destDir, expectFile) {
  await fs.promises.mkdir(destDir, { recursive: true })
  const tmpDir = path.join(os.tmpdir(), `envhub-extract-${Date.now()}`)

  // 注意: PowerShell 脚本必须保持单行安全 —— 换行符与引号转义
  // 出错时不会抛异常，只会静默返回空，因此用 'OK' 标记成功
  const psLiteral = s => `'${String(s).replace(/'/g, "''")}'`

  const ps = [
    "$ErrorActionPreference='Stop'",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
    `$zip=[System.IO.Compression.ZipFile]::OpenRead(${psLiteral(zipFile)})`,
    `try {`,
    `  $dir=${psLiteral(tmpDir)}`,
    `  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }`,
    `  foreach ($e in $zip.Entries) {`,
    `    $t = Join-Path $dir $e.FullName`,
    `    if ([string]::IsNullOrEmpty($e.Name)) {`,
    `      New-Item -ItemType Directory -Path $t -Force | Out-Null`,
    `    } else {`,
    `      $p = Split-Path $t -Parent`,
    `      if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }`,
    `      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $true)`,
    `    }`,
    `  }`,
    `} finally { $zip.Dispose() }`,
    `Write-Output 'ENVBHUB_OK'`
  ].join('; ')

  const runPs = script => new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 20 * 60 * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
    )
  })

  let res = await runPs(ps)
  let ok = !res.err && res.stdout.includes('ENVBHUB_OK')

  // 回退方案: Expand-Archive
  if (!ok) {
    res = await runPs(
      `Expand-Archive -LiteralPath ${psLiteral(zipFile)} -DestinationPath ${psLiteral(tmpDir)} -Force; Write-Output 'ENVBHUB_OK'`
    )
    ok = !res.err && res.stdout.includes('ENVBHUB_OK')
  }

  // 校验临时目录里确实有文件 —— 防止"解压失败却报告成功"
  let extracted = []
  try {
    extracted = await fs.promises.readdir(tmpDir)
  } catch { /* 目录都不存在，说明彻底失败 */ }

  if (!ok || extracted.length === 0) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    const detail = res.stderr ? `\n${res.stderr.slice(0, 300)}` : ''
    throw new Error(`解压失败，安装包可能已损坏${detail}`)
  }

  await moveDirectoryContents(tmpDir, destDir)
  await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

  // 校验目标文件是否到位
  if (expectFile && !fs.existsSync(path.join(destDir, expectFile))) {
    throw new Error(`解压完成但未找到 ${expectFile}，安装包结构可能与预期不符`)
  }

  return destDir
}

async function moveDirectoryContents(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true })
  const items = await fs.promises.readdir(src, { withFileTypes: true })
  for (const item of items) {
    const s = path.join(src, item.name)
    const d = path.join(dest, item.name)
    try {
      await fs.promises.rename(s, d)
    } catch {
      // 跨卷时 rename 失败，回退为复制
      try {
        await fs.promises.cp(s, d, { recursive: true, force: true })
        await fs.promises.rm(s, { recursive: true, force: true }).catch(() => {})
      } catch {}
    }
  }
}

/** 广播环境变量变更，让新进程立即生效 */
function broadcastEnvChange() {
  return new Promise(resolve => {
    const HWND_BROADCAST = 0xffff
    const WM_SETTINGCHANGE = 0x001A
    const SMTO_ABORTIFHUNG = 0x0002

    const ps = `
$sig = @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
$t = Add-Type -MemberDefinition $sig -Name 'Win32EnvBroadcast' -Namespace 'EnvHub' -PassThru
$r = [UIntPtr]::Zero
$t::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) | Out-Null
Write-Output 'sent'
`
    exec(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { timeout: 15000, windowsHide: true },
      () => resolve(true)
    )
  })
}

module.exports = {
  execAsync,
  elevate,
  extractZip,
  moveDirectoryContents,
  broadcastEnvChange
}