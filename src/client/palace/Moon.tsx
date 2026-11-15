/**
 * 书格子右上角的月亮：显示阅读进度（外圈 + 百分比），点一下进入阅读。
 * 设计稿用的是水彩月亮图（1.9 MB），这里用 SVG 画一个相近的，不增加插件体积。
 */
import { useId } from 'react'

export function Moon({ percent, title, onOpen }: { percent?: number; title: string; onOpen: () => void }) {
  const id = useId().replace(/:/g, '')
  const pct = percent === undefined ? undefined : Math.round(Math.max(0, Math.min(1, percent)) * 100)
  return (
    <button type="button" className="mp-moon" title={pct === undefined ? `开始读《${title}》` : `继续读《${title}》 · 已读 ${pct}%`}
      onPointerDown={e => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onOpen() }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id={`m${id}`} cx="42%" cy="38%" r="62%">
            <stop offset="0" stopColor="#fffbea" />
            <stop offset=".55" stopColor="#f6e7b4" />
            <stop offset="1" stopColor="#e3c27a" />
          </radialGradient>
          <radialGradient id={`h${id}`} r="50%">
            <stop offset=".6" stopColor="#fff2b8" stopOpacity="0" />
            <stop offset=".8" stopColor="#fff2b8" stopOpacity=".35" />
            <stop offset="1" stopColor="#fff2b8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill={`url(#h${id})`} />
        <circle className="mp-moon-wash" cx="50" cy="50" r="44" />
        {pct !== undefined && <circle className="mp-moon-ring" cx="50" cy="50" r="44" pathLength="100" strokeDasharray={`${pct} 100`} />}
        <circle cx="50" cy="50" r="33" fill={`url(#m${id})`} />
        <circle cx="40" cy="43" r="4" fill="#cdb57e" opacity=".35" />
        <circle cx="60" cy="59" r="5.5" fill="#cdb57e" opacity=".28" />
        <circle cx="56" cy="37" r="2.5" fill="#cdb57e" opacity=".3" />
      </svg>
      {pct !== undefined && <span className="mp-moon-pct">{pct}%</span>}
    </button>
  )
}
