/**
 * 格子右上角的水彩图标 + 进度环 + 百分比（移植自原型的 .moon-button）。书点它进入阅读，其他格子点它和点格子一样。
 * 框固定 77×95（scale = 1 时的像素，整个格子由外层 transform 缩放），轴测时图标立起来（palace.css）。
 */
import { iconUrl } from './icons.ts'

export function percentText(p: number): string {
  const v = Math.max(0, Math.min(1, p)) * 100
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1)}%`
}

export function Moon({ icon, percent, label, onOpen }: { icon: string; percent?: number; label: string; onOpen?: () => void }) {
  const pct = percent === undefined ? undefined : Math.max(0, Math.min(1, percent)) * 100
  return (
    <button type="button" className="mp-moon" aria-label={label}
      onPointerDown={onOpen ? e => e.stopPropagation() : undefined}
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen() } : undefined}>
      <span className="mp-moon-shadow" aria-hidden="true" />
      <span className="mp-moon-relief">
        <span className="mp-moon-halo" aria-hidden="true" />
        <svg className="mp-moon-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="mp-ring-wash" cx="50" cy="50" r="42" />
          {pct !== undefined && <circle className="mp-ring-progress" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${pct} 100`} />}
        </svg>
        <img src={iconUrl(icon)} alt="" draggable={false} />
      </span>
      {percent !== undefined && <span className="mp-moon-pct">{percentText(percent)}</span>}
    </button>
  )
}
