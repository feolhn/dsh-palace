/**
 * 格子右上角的图标 + 进度环 + 百分比（移植自原型的 .moon-button）。书点它进入阅读，其他格子点它和点格子一样。
 * 框固定 77×95（scale = 1 时的像素，整个格子由外层 transform 缩放）。轴测时图标立起来、带投影，进度环留在地面（#40，palace.css）。
 */
import { THEMES, iconImage, useThemeId } from './theme.ts'

export function percentText(p: number): string {
  const v = Math.max(0, Math.min(1, p)) * 100
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`
}

/** 像素皮肤的进度环：按 2px 一格把圆环拆成方块（阶梯轮廓），从 12 点钟顺时针算进度。 */
const STEP = 200 / 77 // viewBox 100 对应 77px，一格 2px
const PIXEL_RING = (() => {
  const cells: { x: number; y: number; turn: number }[] = []
  const n = Math.ceil(100 / STEP)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = (i + 0.5) * STEP - 50, cy = (j + 0.5) * STEP - 50
      if (Math.abs(Math.hypot(cx, cy) - 42) > STEP * 0.55) continue
      const turn = ((Math.atan2(cx, -cy) / (2 * Math.PI)) + 1) % 1
      cells.push({ x: i * STEP, y: j * STEP, turn })
    }
  }
  return cells
})()

function PixelRing({ pct }: { pct: number | undefined }) {
  return (
    <svg className="mp-moon-ring mp-pixel-ring" viewBox="0 0 100 100" shapeRendering="crispEdges">
      {PIXEL_RING.map(c => (
        <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={STEP} height={STEP}
          className={pct !== undefined && c.turn * 100 < pct ? 'mp-ring-progress' : 'mp-ring-wash'} />
      ))}
    </svg>
  )
}

export function Moon({ icon, percent, label, onOpen }: { icon: string; percent?: number; label: string; onOpen?: () => void }) {
  const themeId = useThemeId()
  const pct = percent === undefined ? undefined : Math.max(0, Math.min(1, percent)) * 100
  return (
    <button type="button" className="mp-moon" aria-label={label}
      onPointerDown={onOpen ? e => e.stopPropagation() : undefined}
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen() } : undefined}>
      <span className="mp-moon-shadow" aria-hidden="true" />
      {/* 光晕和进度环贴在地面上（轴测时跟着地面变成椭圆），只有图标立起来 */}
      <span className="mp-moon-ground" aria-hidden="true">
        <span className="mp-moon-halo" />
        {THEMES[themeId].edges === 'hard' ? <PixelRing pct={pct} /> : (
          <svg className="mp-moon-ring" viewBox="0 0 100 100">
            <circle className="mp-ring-wash" cx="50" cy="50" r="42" />
            {pct !== undefined && <circle className="mp-ring-progress" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${pct} 100`} />}
          </svg>
        )}
      </span>
      <span className="mp-moon-relief">
        <img {...iconImage(themeId, icon)} alt="" draggable={false} />
      </span>
      {percent !== undefined && <span className="mp-moon-pct">{percentText(percent)}</span>}
    </button>
  )
}
