/**
 * 阅览室（#29 第二步，移植原型的 #room / #notes-panel）：点开书 / 笔记格子后，这一格在网格里展开（Palace 负责几何），
 * 里面是标题、备注、右上角图标（点了进入阅读）和笔记本；三个标签是画面顶上的舷窗（Palace 里的 RoomTabs）。
 */
import { useEffect, useState } from 'react'
import type { Cell, CellSummary, Palace } from '../../shared/palace.ts'
import { Notebook, type NotebookTab } from '../notebook/Notebook.tsx'
import { palaceOp } from './data.ts'
import { ICONS, iconOf, iconUrl } from './icons.ts'
import { Moon } from './Moon.tsx'

export function tabsOf(summary: CellSummary | undefined): [NotebookTab, string][] {
  // 笔记格子没有原文，也就没有进度
  return summary?.source === undefined && (summary?.total ?? 0) === 0
    ? [['cards', '卡片'], ['inspirations', '灵感']]
    : [['progress', '进度'], ['cards', '卡片'], ['inspirations', '灵感']]
}

/** 画面顶上的三个舷窗标签（原型 #note-tabs）。 */
export function RoomTabs({ summary, tab, onTab, style }: { summary?: CellSummary; tab: NotebookTab; onTab: (t: NotebookTab) => void; style?: React.CSSProperties }) {
  const tabs = tabsOf(summary)
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0]
  return (
    <nav className="mp-tabs" role="tablist" aria-label="笔记本" style={style} onPointerDown={e => e.stopPropagation()}>
      {tabs.map(([t, label]) => (
        <button key={t} type="button" role="tab" aria-selected={current === t} onClick={() => onTab(t)}>
          <span className="mp-porthole" aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

export function Room({ palace, cellId, summary, sessionId, tab, onTab, onRead, onClose }: {
  palace: Palace; cellId: string; summary?: CellSummary; sessionId?: string
  tab: NotebookTab; onTab: (t: NotebookTab) => void; onRead: () => void; onClose: () => void
}) {
  const cell = palace.cells.find(c => c.id === cellId) as Cell
  const [title, setTitle] = useState(cell.title)
  const [subtitle, setSubtitle] = useState(cell.subtitle ?? '')
  const [error, setError] = useState<string>()
  const [armed, setArmed] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    setTitle(cell.title)
    setSubtitle(cell.subtitle ?? '')
  }, [cell.id, cell.title, cell.subtitle])

  const run = (op: string, args: Record<string, unknown>) => palaceOp(op, { id: cell.id, ...args }).catch((e: Error) => { setError(e.message); throw e })
  const saveText = () => {
    if (title.trim() === cell.title && subtitle.trim() === (cell.subtitle ?? '')) return
    void run('updateCell', { title, subtitle: subtitle.trim() === '' ? null : subtitle }).catch(() => setTitle(cell.title))
  }
  const close = () => { saveText(); onClose() }
  const tabs = tabsOf(summary)
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0]
  const readable = summary?.source !== undefined

  return (
    <div className="mp-room-panel" onPointerDown={e => e.stopPropagation()}>
      <div className="mp-room-heading">
        <div className="mp-room-heading-text">
          <span className="mp-eyebrow">{cell.kind === 'book' ? 'READING ROOM' : 'NOTEBOOK'}</span>
          <input className="mp-room-sub" value={subtitle} placeholder="备注（作者、中文名……随便写）" onChange={e => setSubtitle(e.target.value)} onBlur={saveText}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <input className="mp-room-title" value={title} onChange={e => setTitle(e.target.value)} onBlur={saveText}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </div>
        <div className="mp-room-moon">
          <Moon icon={iconOf(cell)} percent={summary?.percent} label={readable ? `阅读《${cell.title}》` : '换一个图标'}
            onOpen={readable ? onRead : () => setPicking(!picking)} />
          {readable && <button type="button" className="mp-text-btn mp-room-icon-btn" onClick={() => setPicking(!picking)}>换图标</button>}
        </div>
        {picking && (
          <div className="mp-icon-picker" role="listbox" aria-label="选一个图标">
            {ICONS.map(k => (
              <button key={k} type="button" role="option" aria-selected={iconOf(cell) === k} title={k}
                onClick={() => { void run('updateCell', { icon: k }); setPicking(false) }}>
                <img src={iconUrl(k)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>

      <Notebook id={cell.id} title={cell.title} subtitle={cell.subtitle} sessionId={sessionId} tab={current} onTab={onTab} hideTabs />

      {error && <p className="mp-error">{error}</p>}
      <div className="mp-room-footer">
        <button type="button" className="mp-text-btn" onClick={close}>← 回到宫殿</button>
        <span className="mp-spacer" />
        {cell.parentId !== null && <button type="button" className="mp-text-btn" onClick={() => void run('moveCell', { parentId: null })}>移出分组</button>}
        <button type="button" className="mp-text-btn mp-danger"
          onClick={() => (armed ? void run('deleteCell', {}).then(onClose) : setArmed(true))}
          onBlur={() => setArmed(false)}>
          {armed ? '再点一次删除（卡片也会删掉）' : '删除'}
        </button>
      </div>
    </div>
  )
}
