/**
 * 把排版结果画到 canvas 上：纸色 + 棉纸纹理 + 文字。导出的 PNG 就是这张 canvas。
 */
import { FONTS, H, W, inkFor, type ShareDraft, type Layout } from './model.ts'

let texture: HTMLCanvasElement | undefined

/** 棉纸纹理：固定种子生成，每次都一样；只生成一次。 */
function paperTexture(): HTMLCanvasElement {
  if (texture) return texture
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  let seed = 24681357
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  // 低频明暗起伏（双线性插值的随机场）+ 细颗粒
  const cols = 73
  const rows = 97
  const field = Array.from({ length: cols * rows }, random)
  const image = ctx.createImageData(W, H)
  const data = image.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = (x / (W - 1)) * (cols - 1)
      const fy = (y / (H - 1)) * (rows - 1)
      const ix = Math.min(cols - 2, fx | 0)
      const iy = Math.min(rows - 2, fy | 0)
      const tx = fx - ix
      const ty = fy - iy
      const a = field[iy * cols + ix] * (1 - tx) + field[iy * cols + ix + 1] * tx
      const b = field[(iy + 1) * cols + ix] * (1 - tx) + field[(iy + 1) * cols + ix + 1] * tx
      const shade = Math.max(215, Math.min(255, 247 + (a * (1 - ty) + b * ty - 0.5) * 9 + (random() - 0.5) * 30))
      const i = (y * W + x) * 4
      data[i] = data[i + 1] = data[i + 2] = shade
      data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  // 纤维
  for (let i = 0; i < 10500; i++) {
    const x = random() * W
    const y = random() * H
    const length = 2 + random() * 23
    const angle = random() * Math.PI * 2
    const dx = Math.cos(angle) * length
    const dy = Math.sin(angle) * length
    ctx.lineWidth = 0.4 + random() * 0.85
    ctx.strokeStyle = `rgba(90,85,71,${0.08 + random() * 0.24})`
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + dx * 0.6 + 1, y + dy * 0.4, x + dx, y + dy)
    ctx.stroke()
    ctx.strokeStyle = '#ffffff8a'
    ctx.beginPath()
    ctx.moveTo(x + 0.7, y + 0.7)
    ctx.lineTo(x + dx + 0.7, y + dy + 0.7)
    ctx.stroke()
  }
  // 杂点
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(78,65,44,${0.12 + random() * 0.28})`
    ctx.beginPath()
    ctx.ellipse(random() * W, random() * H, 0.35 + random() * 0.55, 0.5 + random() * 1.2, random() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  texture = canvas
  return canvas
}

export function fontCss(draft: ShareDraft, size: number): string {
  return `400 ${size}px ${FONTS[draft.font].family}`
}

/** 等字体可用后再量字宽，否则断行会按回退字体算错。 */
export async function loadFont(draft: ShareDraft): Promise<void> {
  try { await document.fonts.load(fontCss(draft, 50), '字') } catch { /* 系统字体不需要加载 */ }
}

export function measurer(ctx: CanvasRenderingContext2D, draft: ShareDraft) {
  return (text: string, size: number) => { ctx.font = fontCss(draft, size); return ctx.measureText(text).width }
}

export function draw(ctx: CanvasRenderingContext2D, draft: ShareDraft, layout: Layout): void {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = draft.color
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = 0.62
  ctx.drawImage(paperTexture(), 0, 0)
  ctx.restore()

  const ink = inkFor(draft.color)
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.textBaseline = 'top'
  ctx.save()
  ctx.beginPath()
  ctx.rect(105, 95, 870, H - 190)
  ctx.clip()
  const x = draft.align === 'center' ? W / 2 : 120
  ctx.textAlign = draft.align
  for (const block of layout.blocks) {
    ctx.font = fontCss(draft, block.size)
    // 想法前面一道短线，和原文隔开
    if (block.kind === 'note' && layout.blocks.length > 1) {
      ctx.save()
      ctx.globalAlpha = 0.36
      ctx.lineWidth = 1
      const lineX = draft.align === 'center' ? W / 2 - 25 : 120
      ctx.beginPath()
      ctx.moveTo(lineX, block.top - 23)
      ctx.lineTo(lineX + 50, block.top - 23)
      ctx.stroke()
      ctx.restore()
    }
    ctx.globalAlpha = block.kind === 'note' ? 0.82 : 0.96
    block.lines.forEach((line, i) => ctx.fillText(line, x, block.top + i * block.leading))
  }
  ctx.restore()

  ctx.textAlign = 'right'
  ctx.font = fontCss(draft, 27)
  ctx.globalAlpha = 0.78
  layout.source.forEach((line, i) => ctx.fillText(line, 960, layout.sourceTop + i * 38))
  ctx.globalAlpha = 1
}
