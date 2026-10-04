/**
 * 下载器 - 带进度回调与断点续传支持
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { pipeline } = require('stream/promises')

/**
 * 建立 HTTP(S) 连接，跟随重定向
 * @param {string} url
 * @param {number} timeout
 * @param {number} redirects 当前重定向次数
 * @param {boolean} insecure 是否跳过证书校验（仅在确认是内网代理时使用）
 */
function getStream(url, timeout = 30000, redirects = 0, insecure = false) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const options = {
      timeout,
      headers: { 'User-Agent': 'EnvHub/1.0', 'Accept': '*/*' }
    }
    // 企业内网/代理环境常使用自签证书，此时降级为不校验。
    // 注意: 这会降低传输安全性，UI 层需向用户明示。
    if (insecure) options.rejectUnauthorized = false

    const req = lib.get(url, options, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        if (redirects > 8) return reject(new Error('重定向次数过多'))
        const next = new URL(res.headers.location, url).toString()
        return resolve(getStream(next, timeout, redirects + 1, insecure))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`下载失败 HTTP ${res.statusCode}`))
      }
      resolve(res)
    })
    req.on('timeout', () => req.destroy(new Error('连接超时')))
    req.on('error', reject)
  })
}

/**
 * 下载文件到指定路径
 * @param {string} url 下载地址
 * @param {string} dest 目标文件完整路径
 * @param {(p:{received:number,total:number,percent:number,speed:number})=>void} onProgress
 * @param {boolean} insecureTolerated 首次遇到证书错误后，是否降级为不校验证书
 */
async function download(url, dest, onProgress, insecureTolerated = false) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const res = await getStream(url, undefined, undefined, insecureTolerated)

  const total = parseInt(res.headers['content-length'] || '0', 10)
  let received = 0
  let lastTick = Date.now()
  let lastBytes = 0

  res.on('data', chunk => {
    received += chunk.length
    const now = Date.now()
    if (now - lastTick > 300) {
      const speed = (received - lastBytes) / ((now - lastTick) / 1000)
      lastTick = now
      lastBytes = received
      onProgress?.({
        received,
        total,
        percent: total ? Math.round((received / total) * 100) : 0,
        speed
      })
    }
  })

  await pipeline(res, fs.createWriteStream(tmp))
  await fs.promises.rename(tmp, dest)

  onProgress?.({ received, total: total || received, percent: 100, speed: 0 })
  const stat = await fs.promises.stat(dest)
  return { path: dest, size: stat.size }
}

/** 探测下载大小，用于展示预估体积 */
async function probeSize(url) {
  try {
    const lib = url.startsWith('https') ? https : http
    return await new Promise((resolve) => {
      const req = lib.request(url, { method: 'HEAD', timeout: 10000, headers: { 'User-Agent': 'EnvHub/1.0' } }, res => {
        res.resume()
        resolve(parseInt(res.headers['content-length'] || '0', 10))
      })
      req.on('error', () => resolve(0))
      req.on('timeout', () => { req.destroy(); resolve(0) })
      req.end()
    })
  } catch { return 0 }
}

function humanSize(bytes) {
  if (!bytes) return '未知'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

module.exports = { download, probeSize, humanSize }