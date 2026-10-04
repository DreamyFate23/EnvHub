/**
 * 端到端实测: 真实下载 + 安装 + 检测 + 卸载 (7-Zip, 体积小速度快)
 * 用法: node test-e2e.js [envId]
 */
const os = require('os')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const detector = require('./src/main/detector')
const installer = require('./src/main/installer')
const uninstaller = require('./src/main/uninstaller')
const envvars = require('./src/main/envvars')
const { ENV_MAP } = require('./src/main/catalog/environments')

const targetId = process.argv[2] || 'sevenzip'
const env = ENV_MAP[targetId]

function log(...a) { console.log(...a) }
function progress(evt) {
  if (evt.phase === 'download' && evt.percent !== undefined) {
    if (evt.percent % 25 === 0 || evt.percent === 100) {
      process.stdout.write(`\r    下载 ${evt.percent}% (${((evt.received||0)/1048576).toFixed(1)}MB)      `)
    }
  } else if (evt.message) {
    log(`    [${evt.phase}] ${evt.message}`)
  }
}

;(async () => {
  if (!env) { console.error('未知环境'); process.exit(1) }

  log('='.repeat(72))
  log(`端到端实测: ${env.name}`)
  log('='.repeat(72))

  // 1. 安装前状态
  log('\n[1/5] 检查安装前状态...')
  detector.clearDetectionCache()
  let det = await detector.detectOne(env)
  log(`    已安装: ${det.installed}  版本: ${det.version || '-'}`)
  if (det.installed && !process.argv.includes('--force')) {
    log('\n该环境已安装，跳过安装测试。使用 --force 可强制重装。')
  }

  // 2. PATH 快照（用于验证卸载后的清理）
  const before = await envvars.readAll()
  const beforeCount = before.user.path.length
  log(`\n[2/5] 用户级 PATH 条目数: ${beforeCount}`)

  // 3. 安装
  if (!det.installed || process.argv.includes('--force')) {
    log('\n[3/5] 开始安装...')
    const t0 = Date.now()
    try {
      const r = env.installer.strategy === 'zip'
        ? await installer.installPortable(env, null, progress)
        : await installer.install(env, null, progress)
      log(`\n    安装完成，用时 ${((Date.now()-t0)/1000).toFixed(1)}s`)
      log(`    结果: ${JSON.stringify(r)}`)
    } catch (e) {
      log(`\n    安装失败: ${e.message}`)
      log(`    详细日志: ${e.log || '(无)'}`)
    }
  } else {
    log('\n[3/5] 跳过（已安装）')
  }

  // 4. 重新检测
  log('\n[4/5] 重新检测...')
  await new Promise(r => setTimeout(r, 3000))
  detector.clearDetectionCache()
  det = await detector.detectOne(env)
  log(`    已安装: ${det.installed}  版本: ${det.version || '-'}`)
  if (det.exePath) log(`    路径: ${det.exePath}`)
  if (det.uninstallString) log(`    卸载命令: ${det.uninstallString.slice(0,60)}`)

  // 5. 卸载
  if (process.argv.includes('--uninstall')) {
    log('\n[5/5] 开始卸载...')
    try {
      const r = await uninstaller.uninstall(env.id, det, progress)
      log(`    卸载完成: ${JSON.stringify(r)}`)
    } catch (e) {
      log(`    卸载失败: ${e.message}`)
    }

    await new Promise(r => setTimeout(r, 3000))
    detector.clearDetectionCache()
    det = await detector.detectOne(env)
    const after = await envvars.readAll()
    log(`    卸载后已安装: ${det.installed}`)
    log(`    PATH 条目: ${beforeCount} -> ${after.user.path.length}`)
  } else {
    log('\n[5/5] 跳过卸载（加 --uninstall 参数可测试卸载）')
  }

  log('\n' + '='.repeat(72))
})().catch(e => { console.error('异常:', e); process.exit(1) })