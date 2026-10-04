/**
 * 实测所有环境的最新版本查询接口
 * 用法: node test-latest.js
 */
const { ENVIRONMENTS } = require('./src/main/catalog/environments')
const detector = require('./src/main/detector')

;(async () => {
  console.log('='.repeat(86))
  console.log('实测各环境最新版本查询接口')
  console.log('='.repeat(86))

  let ok = 0, fail = 0, skipped = 0
  const bad = []

  for (const e of ENVIRONMENTS) {
    if (!e.latest) { console.log(`  [无配置] ${e.name}`); skipped++; continue }
    if (e.latest.type === 'static') {
      console.log(`  [静态]   ${e.name.padEnd(24)} ${e.latest.value}`)
      skipped++
      continue
    }

    const t0 = Date.now()
    let v = null, err = null
    try {
      v = await detector.fetchLatestVersion(e)
    } catch (ex) { err = ex.message }
    const ms = Date.now() - t0

    if (v && v !== 'latest') {
      // 校验版本格式合理性
      const sane = /^\d+\.\d+/.test(v)
      console.log(`  [${sane ? ' OK ' : '  ? '}]   ${e.name.padEnd(24)} ${String(v).padEnd(16)} ${ms}ms`)
      ok++
      if (!sane) bad.push(`${e.name}: 版本格式可疑 -> ${v}`)
    } else {
      console.log(`  [失败]   ${e.name.padEnd(24)} ${err || '返回空'}  ${ms}ms`)
      fail++
      bad.push(`${e.name}: ${err || '返回空'}`)
    }
  }

  console.log('\n' + '='.repeat(86))
  console.log(`成功 ${ok} / 失败 ${fail} / 跳过 ${skipped}   共 ${ENVIRONMENTS.length}`)
  if (bad.length) {
    console.log('\n需要关注:')
    for (const b of bad) console.log(`  - ${b}`)
  }
  console.log('='.repeat(86))
})()