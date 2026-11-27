/**
 * 轴测视图里格子之间的银白电弧（#8 / #42）。几何和样式移植自原型 connections.js；数据是真实的联想（CONTRACT §8）。
 * - 每格默认只画最强的 5 条，鼠标停在格子上时显示它的全部电弧和理由
 * - 越久没有新证据越暗（不删，重新聊起来又会亮）
 */
import type { CSSProperties } from 'react'
import type { Cell } from '../../shared/palace.ts'
import type { Arc } from './data.ts'
import { arcPaths, project, type Matrix } from './projection.ts'
import { THEMES, useThemeId } from './theme.ts'

const PER_CELL = 5
const MAX_STRANDS = 5

interface Props {
  arcs: Arc[]
  cells: Cell[]
  hover?: string
  amount: number
  m: Matrix
  cam: { x: number; y: number; scale: number }
  size: { w: number; h: number }
  B: number
  worldCell: (c: Cell) => { col: number; row: number }
}

export function Arcs({ arcs, cells, hover, amount, m, cam, size, B, worldCell }: Props) {
  const pixel = THEMES[useThemeId()].edges === 'hard'
  const byId = new Map(cells.filter(c => c.kind !== 'group').map(c => [c.id, c]))
  // 电弧落在格子右上角（月亮 / 图标的位置），跟着图标一起抬高
  const anchor = (c: Cell) => {
    const w = worldCell(c)
    const world = { x: w.col * B + B - 43, y: w.row * B + 42 }
    const p = project(m, cam.x + world.x * cam.scale, cam.y + world.y * cam.scale, size.w, size.h)
    return { screen: { x: p.x, y: p.y - 35 * amount * cam.scale }, world }
  }

  const count = new Map<string, number>()
  const shown = arcs.filter((a) => {
    if (!byId.has(a.from) || !byId.has(a.to)) return false
    const strong = (count.get(a.from) ?? 0) < PER_CELL || (count.get(a.to) ?? 0) < PER_CELL
    if (strong) for (const id of [a.from, a.to]) count.set(id, (count.get(id) ?? 0) + 1)
    return strong || a.from === hover || a.to === hover
  })
  if (shown.length === 0) return null

  const now = Date.now()
  const drawn = shown.map((arc, index) => {
    const a = anchor(byId.get(arc.from)!), b = anchor(byId.get(arc.to)!)
    const geo = arcPaths({ a: a.screen, b: b.screen, wa: a.world, wb: b.world, strands: Math.min(arc.strands, MAX_STRANDS), seed: index, m, amount, scale: cam.scale, step: pixel ? 3 : undefined })
    const days = Math.max(0, (now - Date.parse(arc.lastAt)) / 86400000)
    const related = hover !== undefined && (arc.from === hover || arc.to === hover)
    return { arc, index, geo, related, fade: 0.45 + 0.55 * Math.exp(-days / 60) }
  })

  return (
    <>
      <svg className="mp-arcs" width={size.w} height={size.h} style={{ opacity: amount }} aria-hidden="true">
        {drawn.map(({ arc, index, geo, related, fade }) => (
          <g key={`${arc.from}|${arc.to}`} className={`mp-arc ${related ? 'is-related' : hover !== undefined ? 'is-muted' : ''}`}
            style={hover === undefined ? { opacity: 0.76 * fade } : undefined}>
            {geo.strands.map((d, s) => (
              <g key={s} className="mp-arc-strand" style={{ '--arc-delay': `${-index * 0.73 - s * 1.17}s` } as CSSProperties}>
                <path className="mp-arc-halo" d={d} />
                <path className="mp-arc-outline" d={d} />
                <path className="mp-arc-core" d={d} />
                <path className="mp-arc-current" d={d} />
                <path className="mp-arc-branches" d={geo.branches[s]} />
              </g>
            ))}
          </g>
        ))}
      </svg>
      {drawn.filter(d => d.related).map(({ arc, geo }) => (
        <div key={`${arc.from}|${arc.to}`} className="mp-arc-why" style={{ left: geo.apex.x, top: geo.apex.y, opacity: amount }}>
          {arc.why}{arc.strands > 1 && <span> · {arc.strands} 股</span>}
        </div>
      ))}
    </>
  )
}
