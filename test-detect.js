/**
 * 检测引擎自测 - 验证能否正确识别本机环境
 * 用法: node test-detect.js
 */
const detector = require('./src/main/detector')
const { ENVIRONMENTS } = require('./src/main/catalog/environments')

;(async () => {
  console.log(`开始检测 ${ENVIRONMENTS.length} 个环境...\n`)
  const t0 = Date.now()
  const results = await detector.detectAll(p => {
    process.stdout.write(`\r  扫描 ${p.current}/${p.total} ${p.name}`.padEnd(60))
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`\n\n完成，用时 ${elapsed}s\n`)
  console.log('='.repeat(78))
  console.log('已安装的环境:')
  console.log('='.repeat(78))

  const installed = results.filter(r => r.installed)
  for (const r of installed) {
    const env = ENVIRONMENTS.find(e => e.id === r.id)
    console.log(`\n  ${env.name.padEnd(26)} v${(r.version || '?').padEnd(12)} [${r.source}]`)
    if (r.exePath) console.log(`  ${' '.repeat(28)}${r.exePath}`)
    if (r.registryKey) console.log(`  ${' '.repeat(28)}注册表: ${r.registryKey.slice(0, 70)}`)
    if (r.uninstallString) console.log(`  ${' '.repeat(28)}卸载: ${r.uninstallString.slice(0, 70)}`)
  }

  console.log('\n' + '='.repeat(78))
  console.log('未检测到:')
  console.log('='.repeat(78))
  for (const r of results.filter(r => !r.installed)) {
    console.log(`  ${ENVIRONMENTS.find(e => e.id === r.id).name}`)
  }

  console.log('\n' + '='.repeat(78))
  console.log(`汇总: ${installed.length}/${ENVIRONMENTS.length} 已安装`)
  console.log('='.repeat(78))
})().catch(e => {
  console.error('检测失败:', e)
  process.exit(1)
})