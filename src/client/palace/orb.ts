/**
 * AI 光球（#29 第三步）的纯计算，移植自设计负责人原型 palace-orb.js：
 * - 宫殿里：光球待在一个空格子里慢慢漂，碰到格子边缘或鼠标会弹开；长按可以拖到别的空格；
 * - 阅读时：待在书右上方斜对角那一格（缩小一半），不挡正文。
 * 坐标都是屏幕坐标（宫殿根元素内）。
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Cell extends Rect { col: number; row: number }

export interface OrbView {
  width: number
  height: number
  /** 镜头：世界坐标原点在屏幕上的位置和格子边长（屏幕像素）。 */
  x: number
  y: number
  spacing: number
  /** 有东西的格子（世界坐标）。 */
  occupied: { col: number; row: number }[]
  /** 不能放光球的区域（标题、底栏、分组框……）。 */
  exclusions: Rect[]
  /** 阅读时书在屏幕上的位置。 */
  readerRect?: Rect
}

export interface Ball { x: number; y: number; vx: number; vy: number; sx: number; sy: number }
export interface Bounds { w: number; h: number; radius: number }

export const SIZE = 77
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** 阅读时光球待的地方：书右上方斜对角那一格里看得见的部分。 */
export function readerArea(view: OrbView): Rect | undefined {
  const book = view.readerRect
  if (book === undefined) return undefined
  const left = book.x + book.w, right = Math.min(view.width, left + view.spacing)
  const top = Math.max(0, book.y - view.spacing), bottom = book.y
  const area = { x: left + 3, y: top + 3, w: right - left - 6, h: bottom - top - 6 }
  if (area.w < 32 || area.h < 32) return undefined
  if (view.exclusions.some(r => overlaps(area, r))) return undefined
  return area
}

export function scaleFor(view: OrbView, area?: Rect): number {
  return area !== undefined && view.readerRect !== undefined
    ? Math.min(view.spacing / 268 * 0.5, (area.w - 4) / SIZE, (area.h - 4) / SIZE)
    : view.spacing / 268
}

/** 世界坐标 (col,row) 这一格：完全在屏幕里、没有东西、不压着不能放的区域，才能放光球。 */
export function emptyCell(view: OrbView, col: number, row: number): Cell | undefined {
  const r = { col, row, x: view.x + col * view.spacing, y: view.y + row * view.spacing, w: view.spacing, h: view.spacing }
  if (r.x < 12 || r.y < 12 || r.x + r.w > view.width - 12 || r.y + r.h > view.height - 12) return undefined
  if (view.occupied.some(c => c.col === col && c.row === row) || view.exclusions.some(e => overlaps(r, e))) return undefined
  return r
}

/** 自动挑格子时偏向三个边角（右上、右下、左下），每个角取最靠边的几格。 */
export function candidates(view: OrbView): Cell[][] {
  const { width, height, x, y, spacing } = view
  if (spacing < 76) return []
  const all: Cell[] = []
  const firstCol = Math.ceil((12 - x) / spacing), lastCol = Math.floor((width - 12 - x) / spacing) - 1
  const firstRow = Math.ceil((12 - y) / spacing), lastRow = Math.floor((height - 12 - y) / spacing) - 1
  for (let row = firstRow; row <= lastRow; row++) for (let col = firstCol; col <= lastCol; col++) {
    const r = emptyCell(view, col, row)
    if (r) all.push(r)
  }
  const zones = [
    { test: (r: Cell) => r.x + r.w / 2 >= width / 2 && r.y + r.h / 2 < height / 2, score: (r: Cell) => width - r.x - r.w + r.y },
    { test: (r: Cell) => r.x + r.w / 2 >= width / 2 && r.y + r.h / 2 >= height / 2, score: (r: Cell) => width - r.x - r.w + height - r.y - r.h },
    { test: (r: Cell) => r.x + r.w / 2 < width / 2 && r.y + r.h / 2 >= height / 2, score: (r: Cell) => r.x + height - r.y - r.h },
  ]
  return zones.map((zone) => {
    const pool = all.filter(zone.test), min = Math.min(...pool.map(zone.score))
    return pool.filter(r => zone.score(r) <= min + spacing * 0.5)
  }).filter(pool => pool.length > 0)
}

/** 走一步：碰边就反弹，并压扁一下（弹性）。 */
export function step(ball: Ball, bounds: Bounds, dt: number): Ball {
  ball.x += ball.vx * dt
  ball.y += ball.vy * dt
  ball.sx += (1 - ball.sx) * Math.min(1, dt * 9)
  ball.sy += (1 - ball.sy) * Math.min(1, dt * 9)
  const axes = [['x', 'vx', 'sx', 'sy', bounds.w], ['y', 'vy', 'sy', 'sx', bounds.h]] as const
  for (const [axis, velocity, stretch, other, limit] of axes) {
    if (ball[axis] < bounds.radius || ball[axis] > limit - bounds.radius) {
      ball[axis] = clamp(ball[axis], bounds.radius, limit - bounds.radius)
      ball[velocity] *= -1
      ball[stretch] = 0.83
      ball[other] = 1.13
    }
  }
  return ball
}

export interface Cursor { x: number; y: number; vx: number; vy: number; fromX?: number; fromY?: number }

/** 鼠标（没按下时）是一个会动的小圆：撞到光球就把它弹开。坐标相对光球所在的格子。 */
export function collideCursor(ball: Ball, bounds: Bounds, cursor: Cursor, cruise: number): boolean {
  const reach = bounds.radius + 8, dx = ball.x - cursor.x, dy = ball.y - cursor.y, dist = Math.hypot(dx, dy)
  let nx = dx, ny = dy, hit = dist < reach
  if (!hit && cursor.fromX !== undefined && cursor.fromY !== undefined) {
    // 鼠标移得快，一帧里穿过了光球：按线段求交
    const sx = cursor.x - cursor.fromX, sy = cursor.y - cursor.fromY, ox = cursor.fromX - ball.x, oy = cursor.fromY - ball.y
    const a = sx * sx + sy * sy, b = 2 * (ox * sx + oy * sy), c = ox * ox + oy * oy - reach * reach, disc = b * b - 4 * a * c
    if (a > 0 && c >= 0 && disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a)
      if (t >= 0 && t <= 1) { hit = true; nx = ball.x - (cursor.fromX + sx * t); ny = ball.y - (cursor.fromY + sy * t) }
    }
  }
  if (!hit) return false
  let length = Math.hypot(nx, ny)
  if (length < 0.001) { nx = cursor.vx || -ball.vx || 1; ny = cursor.vy || -ball.vy || 0; length = Math.hypot(nx, ny) }
  nx /= length; ny /= length
  const closing = (ball.vx - cursor.vx) * nx + (ball.vy - cursor.vy) * ny
  if (closing < 0) { ball.vx -= 1.8 * closing * nx; ball.vy -= 1.8 * closing * ny }
  const speed = Math.hypot(ball.vx, ball.vy), cap = cruise * 2.2
  if (speed > cap) { ball.vx *= cap / speed; ball.vy *= cap / speed }
  if (dist < reach) {
    let x = clamp(cursor.x + nx * (reach + 0.5), bounds.radius, bounds.w - bounds.radius)
    let y = clamp(cursor.y + ny * (reach + 0.5), bounds.radius, bounds.h - bounds.radius)
    // 被墙挡住：绕着鼠标找最近的空位
    if (Math.hypot(x - cursor.x, y - cursor.y) < reach) {
      let best = Infinity
      for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12, px = cursor.x + Math.cos(angle) * (reach + 0.5), py = cursor.y + Math.sin(angle) * (reach + 0.5)
        if (px < bounds.radius || px > bounds.w - bounds.radius || py < bounds.radius || py > bounds.h - bounds.radius) continue
        const d = Math.hypot(px - ball.x, py - ball.y)
        if (d < best) { best = d; x = px; y = py }
      }
    }
    ball.x = x; ball.y = y
  }
  if (Math.abs(nx) > Math.abs(ny)) { ball.sx = 0.86; ball.sy = 1.1 } else { ball.sx = 1.1; ball.sy = 0.86 }
  return true
}

/** 被撞快了之后慢慢回到巡航速度。 */
export function relaxSpeed(ball: Ball, cruise: number, dt: number): void {
  const speed = Math.hypot(ball.vx, ball.vy)
  if (!speed) return
  const next = speed + (cruise - speed) * (1 - Math.exp(-dt * 1.4))
  ball.vx *= next / speed
  ball.vy *= next / speed
}

/** 在格子里放一个光球：位置随机（偏中间），方向随机，速度随格子大小。 */
export function spawn(cell: Rect, view: OrbView, radius: number, random = Math.random): { ball: Ball; cruise: number } {
  const angle = (0.25 + random() * 0.5) * Math.PI
  const cruise = clamp(view.spacing * 0.045, 7, 15) * 2.5 * 0.8
  const travelX = Math.max(1, cell.w - radius * 2), travelY = Math.max(1, cell.h - radius * 2)
  const aspect = view.readerRect !== undefined ? Math.min(1, travelY / travelX) : 1
  const vx = Math.cos(angle), vy = Math.sin(angle) * aspect, length = Math.hypot(vx, vy)
  return {
    cruise,
    ball: {
      x: clamp(cell.w * (0.3 + random() * 0.4), radius, cell.w - radius),
      y: clamp(cell.h * (0.3 + random() * 0.4), radius, cell.h - radius),
      vx: vx / length * cruise * (random() < 0.5 ? -1 : 1),
      vy: vy / length * cruise * (random() < 0.5 ? -1 : 1),
      sx: 1, sy: 1,
    },
  }
}
