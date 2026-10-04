/**
 * 安装链路自测 (不下大文件，只验证下载与解析逻辑)
 */
const { renderTemplate, renderArgs } = require('./src/main/installer')
const { ENVIRONMENTS } = require('./src/main/catalog/environments')
const { parseUninstallString } = require('./src/main/uninstaller')

const ctx = { version: '1.2.3', installDir: 'C:\\tools\\test', file: 'C:\\temp\\setup.msi', lang: 'zh-CN' }

console.log('='.repeat(90))
console.log('安装 URL 解析检查')
console.log('='.repeat(90))
let bad = 0
for (const e of ENVIRONMENTS) {
  const i = e.installer
  if (!i?.urlTemplate) { console.log(`  [跳过] ${e.name}: 无 urlTemplate`); continue }

  const url = renderTemplate(i.urlTemplate, ctx)
  const ok = /^https?:\/\//.test(url) && !url.includes('{{')
  if (!ok) { bad++; console.log(`  [FAIL] ${e.name}: ${url}`) }
  else console.log(`  [ OK ] ${e.name.padEnd(24)} ${url.slice(0, 62)}`)
}

console.log('\n' + '='.repeat(90))
console.log('静默参数检查')
console.log('='.repeat(90))
for (const e of ENVIRONMENTS) {
  const i = e.installer
  if (!i?.args) { console.log(`  ${e.name.padEnd(24)} (无参数)`); continue }
  const args = renderArgs(i.args, ctx)
  const unresolved = args.filter(a => a.includes('{{'))
  if (unresolved.length) { bad++; console.log(`  [FAIL] ${e.name}: ${unresolved.join(' ')}`) }
  else console.log(`  [ OK ] ${e.name.padEnd(24)} ${args.join(' ').slice(0, 58)}`)
}

console.log('\n' + '='.repeat(90))
console.log('卸载命令解析检查')
console.log('='.repeat(90))
const samples = [
  'MsiExec.exe /X{3E3E3302-0CAD-4D0D-B6C0-206B30773468}',
  'MsiExec.exe /I{8E3EF5A2-585E-453B-B16C-B46E05A62DAC}',
  '"D:\\Git\\unins001.exe"',
  '"C:\\Program Files\\Docker\\Docker\\Docker Desktop Installer.exe" "uninstall --quiet"',
  '"C:\\Program Files\\Python311\\uninstall.exe" /S'
]
for (const s of samples) {
  const r = parseUninstallString(s)
  console.log(`  输入: ${s.slice(0, 70)}`)
  console.log(`  解析: exe="${r?.exe}" args=[${r?.args?.join(' ')}]`)
  if (!r) { bad++ }
  console.log()
}

console.log('='.repeat(90))
console.log(bad === 0 ? '全部检查通过' : `发现 ${bad} 处问题`)
console.log('='.repeat(90))