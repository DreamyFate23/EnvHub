/**
 * 生成应用图标 (ICO 格式)
 * 用纯 Node 实现，不依赖图形库:
 * 先渲染 PNG (手写最小 PNG 编码器)，再打包成 ICO。
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

/* ---------- CRC32 ---------- */
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/* ---------- PNG 编码 ---------- */
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** rgba: Buffer(size*size*4) */
function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 每行前加一个 filter byte (0 = None)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- 绘制 ---------- */
/**
 * EnvHub 图标: 深色圆角方块 + 蓝紫渐变 + 白色 "E"
 */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)

  const radius = size * 0.22
  const cx = size / 2
  const cy = size / 2

  // 圆角矩形的有符号距离
  const sdRoundRect = (x, y) => {
    const hw = size / 2 - size * 0.04
    const hh = size / 2 - size * 0.04
    const qx = Math.abs(x - cx) - (hw - radius)
    const qy = Math.abs(y - cy) - (hh - radius)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  }

  // 判断点是否在 "E" 字形内
  // E 由一条竖笔 + 三条横笔构成
  const inE = (px, py) => {
    const s = size
    const left = s * 0.34
    const right = s * 0.68
    const top = s * 0.27
    const bottom = s * 0.73
    const thick = s * 0.075

    if (px < left || px > right || py < top || py > bottom) return false

    // 竖笔
    if (px < left + thick) return true
    // 上横
    if (py < top + thick) return true
    // 中横
    if (Math.abs(py - (top + bottom) / 2) < thick / 1.6) return true
    // 下横
    if (py > bottom - thick) return true
    return false
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const px = x + 0.5
      const py = y + 0.5

      const d = sdRoundRect(px, py)
      // 2x2 超采样抗锯齿
      let cover = 0
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        if (sdRoundRect(px + ox - 0.5, py + oy - 0.5) < 0) cover++
      }
      cover /= 4

      if (cover <= 0) { rgba[i + 3] = 0; continue }

      // 对角渐变: 左上 #4493f8 -> 右下 #a371f7
      const t = (px + py) / (size * 2)
      let r = Math.round(0x44 + (0xa3 - 0x44) * t)
      let g = Math.round(0x93 + (0x71 - 0x93) * t)
      let b = Math.round(0xf8 + (0xf7 - 0xf8) * t)

      // 叠加 E 字形
      let eCover = 0
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        if (inE(px + ox - 0.5, py + oy - 0.5)) eCover++
      }
      eCover /= 4
      if (eCover > 0) {
        r = Math.round(r * (1 - eCover) + 255 * eCover)
        g = Math.round(g * (1 - eCover) + 255 * eCover)
        b = Math.round(b * (1 - eCover) + 255 * eCover)
      }

      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = Math.round(cover * 255)
    }
  }

  return encodePNG(size, rgba)
}

/* ---------- ICO 打包 ---------- */
function buildICO(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)      // reserved
  header.writeUInt16LE(1, 2)      // type: icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count

  pngs.forEach((png, i) => {
    const size = png.size
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size
    dir[o + 1] = size >= 256 ? 0 : size
    dir[o + 2] = 0   // 调色板数
    dir[o + 3] = 0   // 保留
    dir.writeUInt16LE(1, o + 4)   // color planes
    dir.writeUInt16LE(32, o + 6)  // bits per pixel
    dir.writeUInt32LE(png.data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.data.length
  })

  return Buffer.concat([header, dir, ...pngs.map(p => p.data)])
}

/* ---------- 主流程 ---------- */
const outDir = path.join(__dirname, 'build')
fs.mkdirSync(outDir, { recursive: true })

const pngs = SIZES.map(size => ({ size, data: drawIcon(size) }))
const ico = buildICO(pngs)
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)

// 额外输出一张 256px PNG，便于其它用途
fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[pngs.length - 1].data)

console.log(`icon.ico 已生成: ${(ico.length / 1024).toFixed(1)} KB, ${SIZES.length} 个尺寸`)
console.log(`  尺寸: ${SIZES.join(', ')}`)
console.log(`icon.png 已生成: ${(pngs[pngs.length - 1].data.length / 1024).toFixed(1)} KB`)