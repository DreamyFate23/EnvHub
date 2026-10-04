/**
 * 轻量 HTTP 客户端
 * 独立成模块，避免 catalog 与 detector 之间的循环依赖。
 *
 * 证书策略: 先做正常校验；仅当错误明确是证书/协议问题时，
 * 才降级为不校验重试一次（企业内网代理常见自签证书）。
 * 该降级会降低传输安全性，因此调用方应向用户明示。
 */
const https = require('https')
const http = require('http')

/**
 * @param {string} url
 * @param {number} timeout 毫秒
 * @param {boolean} insecure 是否跳过证书校验
 * @param {number} redirects 已重定向次数
 */
function httpGet(url, timeout = 15000, insecure = false, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const options = {
      timeout,
      headers: {
        'User-Agent': 'EnvHub/1.0 (+https://github.com/envhub)',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }
    if (insecure) options.rejectUnauthorized = false

    const req = lib.get(url, options, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        if (redirects > 8) return reject(new Error('重定向次数过多'))
        let next
        try {
          next = new URL(res.headers.location, url).toString()
        } catch {
          return reject(new Error(`无效的重定向地址: ${res.headers.location}`))
        }
        return resolve(httpGet(next, timeout, insecure, redirects + 1))
      }

      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }

      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => {
        data += c
        // 防止异常大的响应撑爆内存
        if (data.length > 8 * 1024 * 1024) {
          req.destroy()
          reject(new Error('响应内容过大'))
        }
      })
      res.on('end', () => resolve(data))
    })

    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

/** 判断错误是否为证书/协议问题（可降级重试） */
function isCertError(e) {
  return /certificate|SSL|TLS|PROTOCOL|self.signed|unable to verify/i.test(e?.message || '')
}

/**
 * 带证书降级的 GET
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<{text:string, insecure:boolean}>}
 */
async function httpGetSafe(url, timeout = 15000) {
  try {
    return { text: await httpGet(url, timeout, false), insecure: false }
  } catch (e) {
    if (!isCertError(e)) throw e
    return { text: await httpGet(url, timeout, true), insecure: true }
  }
}

module.exports = { httpGet, httpGetSafe, isCertError }