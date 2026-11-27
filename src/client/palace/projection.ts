/**
 * 轴测视图（#42）的纯计算，移植自设计负责人原型（Discussion #40）的 isometric.js / connections.js。
 *
 * - amount：0 = 平面，1 = 正交轴测（绕 Z 转 45°，再绕 X 倾 54.7356°，三轴等比缩短，没有透视）
 * - spread：0 = 分组收起，1 = 所有分组在原地展开（只是显示布局，不改存储的位置）
 * 地面是一个仿射平面：格子、文字、进度贴在地上，只有图标（月亮）立起来。
 */
import type { Cell } from '../../shared/palace.ts'

export interface Matrix { a: number; b: number; c: number; d: number }

const TILT = Math.acos(1 / Math.sqrt(3))

export function matrixOf(amount: number): Matrix {
  const turn = Math.PI / 4 * amount, tilt = TILT * amount
  return { a: Math.cos(turn), b: Math.sin(turn) * Math.cos(tilt), c: -Math.sin(turn), d: Math.cos(turn) * Math.cos(tilt) }
}

/** 平面屏幕坐标 → 投影后的屏幕坐标（绕视野中心）。 */
export function project(m: Matrix, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const cx = w / 2, cy = h / 2
  return { x: cx + m.a * (x - cx) + m.c * (y - cy), y: cy + m.b * (x - cx) + m.d * (y - cy) }
}

/** 屏幕上的位移 → 平面上的位移（拖动、滚轮平移用）。 */
export function delta(m: Matrix, x: number, y: number): { x: number; y: number } {
  const det = m.a * m.d - m.b * m.c
  return { x: (m.d * x - m.c * y) / det, y: (m.a * y - m.b * x) / det }
}

export function unproject(m: Matrix, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const p = delta(m, x - w / 2, y - h / 2)
  return { x: p.x + w / 2, y: p.y + h / 2 }
}

// ---------- 展开布局 ----------

export interface Entry {
  cell: Cell
  /** 展开后在世界网格里的位置和占地（分组占一块矩形）。 */
  col: number
  row: number
  w: number
  h: number
  /** 所在最外层格子的原位置：组里的格子从这里「长」出来。 */
  origin: { col: number; row: number }
  depth: number
}

export interface SpreadLayout {
  entries: Map<string, Entry>
  /** 分组的区域。 */
  frames: Map<string, Entry>
  roots: Entry[]
}

interface Node { cell: Cell; w: number; h: number; children: (Node & { col: number; row: number })[] }
interface Rect { col: number; row: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect) => a.col < b.col + b.w && a.col + a.w > b.col && a.row < b.row + b.h && a.row + a.h > b.row
const byPos = (a: { cell: Cell }, b: { cell: Cell }) => a.cell.row - b.cell.row || a.cell.col - b.cell.col

/** 所有分组原地展开：组头占一格，内容按近似正方形排；最外层撞到就往右挪。 */
export function spreadLayout(cells: readonly Cell[]): SpreadLayout {
  const children = new Map<string | null, Cell[]>()
  for (const c of cells) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c])

  const measure = (cell: Cell): Node => {
    if (cell.kind !== 'group') return { cell, w: 1, h: 1, children: [] }
    const items = (children.get(cell.id) ?? []).map(measure).sort(byPos)
    const columns = Math.max(1, ...items.map(c => c.w), Math.ceil(Math.sqrt(1 + items.reduce((s, c) => s + c.w * c.h, 0))))
    const occupied: Rect[] = [{ col: 0, row: 0, w: 1, h: 1 }]
    const contents: Node['children'] = []
    for (const item of items) {
      for (let col = 0, row = 0; ;) {
        const slot = { ...item, col, row }
        if (col + item.w <= columns && !occupied.some(p => overlaps(slot, p))) { contents.push(slot); occupied.push(slot); break }
        col += 1
        if (col + item.w > columns) { col = 0; row += 1 }
      }
    }
    return { cell, children: contents, w: Math.max(...occupied.map(c => c.col + c.w)), h: Math.max(...occupied.map(c => c.row + c.h)) }
  }

  const placed: (Node & { col: number; row: number })[] = []
  for (const node of (children.get(null) ?? []).map(measure).sort(byPos)) {
    const slot = { ...node, col: node.cell.col, row: node.cell.row }
    for (let hit; (hit = placed.find(p => overlaps(slot, p))) !== undefined;) slot.col = hit.col + hit.w
    placed.push(slot)
  }

  const entries = new Map<string, Entry>(), frames = new Map<string, Entry>()
  const place = (node: Node, col: number, row: number, origin: Entry['origin'], depth: number) => {
    const entry: Entry = { cell: node.cell, col, row, w: node.w, h: node.h, origin, depth }
    entries.set(node.cell.id, entry)
    if (node.cell.kind === 'group') frames.set(node.cell.id, entry)
    for (const child of node.children) place(child, col + child.col, row + child.row, origin, depth + 1)
  }
  for (const r of placed) place(r, r.col, r.row, { col: r.cell.col, row: r.cell.row }, 0)
  return { entries, frames, roots: placed.map(r => entries.get(r.cell.id)!) }
}

/** 展开布局里一格（显示坐标）对应的放置位置：落在格子上 = 那个格子的真实位置；落在分组区域 = 放进分组；空处 = 最外层。 */
export function spreadDrop(layout: SpreadLayout, cells: readonly Cell[], p: { col: number; row: number }): { parentId: string | null; col: number; row: number } {
  const hit = [...layout.entries.values()].find(e => e.col === p.col && e.row === p.row)
  if (hit !== undefined) return { parentId: hit.cell.parentId, col: hit.cell.col, row: hit.cell.row }
  const frame = [...layout.frames.values()].find(e => p.col >= e.col && p.col < e.col + e.w && p.row >= e.row && p.row < e.row + e.h)
  const pos = frame !== undefined ? { parentId: frame.cell.id, col: p.col - frame.col, row: p.row - frame.row } : { parentId: null, ...p }
  // 显示位置和存储位置不一定一致：真实位置上已有格子就往右找空位，免得和看不见的格子互换
  while (cells.some(c => c.parentId === pos.parentId && c.col === pos.col && c.row === pos.row)) pos.col += 1
  return pos
}

// ---------- 电弧 ----------


/** 一条电弧的屏幕路径：抛物线拱起 + 细小的电流抖动；多股在垂直方向错开。 */
export function arcPaths(opts: {
  a: { x: number; y: number }; b: { x: number; y: number }
  /** 两端的世界坐标（决定拱高和错开方向） */
  wa: { x: number; y: number }; wb: { x: number; y: number }
  strands: number; seed: number; m: Matrix; amount: number; scale: number
}): { strands: string[]; branches: string[]; apex: { x: number; y: number } } {
  const { a, b, wa, wb, m, scale } = opts
  const dx = wb.x - wa.x, dy = wb.y - wa.y, distance = Math.max(1, Math.hypot(dx, dy))
  const normal = { x: (m.a * -dy + m.c * dx) / distance * scale, y: (m.b * -dy + m.d * dx) / distance * scale }
  const elevation = Math.min(360, Math.max(180, 110 + distance * 0.38))
  const height = elevation * Math.sin(TILT * opts.amount) * scale
  const strands: string[] = [], branches: string[] = []
  for (let s = 0; s < opts.strands; s++) {
    const separation = (s - (opts.strands - 1) / 2) * 18
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= 72; i++) {
      const t = i / 72, env = Math.sin(Math.PI * t)
      const off = separation * env + Math.sin(t * Math.PI * 26 + opts.seed * 1.3 + s) * 1.35 * env
      pts.push({ x: a.x + (b.x - a.x) * t + normal.x * off, y: a.y + (b.y - a.y) * t + normal.y * off - 4 * t * (1 - t) * height })
    }
    strands.push(pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
    branches.push([22, 47].map((start, j) => {
      const p = pts[start], q = pts[start + 4], r = pts[start + 8], side = j ? 1 : -1
      return `M${p.x.toFixed(1)},${p.y.toFixed(1)} L${(q.x + side * 5 * scale).toFixed(1)},${(q.y - 4 * scale).toFixed(1)} L${(r.x + side * 10 * scale).toFixed(1)},${(r.y - 7 * scale).toFixed(1)}`
    }).join(' '))
  }
  return { strands, branches, apex: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - height } }
}
