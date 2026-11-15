/**
 * 全屏宫殿里点开书 / 笔记格子后的详情（「阅览室」）：盖在宫殿中间。
 * 改名、作者 / 副标题，右上角月亮进入阅读，下面是笔记本；底部移出分组、删除。
 */
import { useEffect, useState } from 'react'
import type { Cell, CellSummary, Palace } from '../../shared/palace.ts'
import { Notebook, type NotebookTab } from '../notebook/Notebook.tsx'
import { palaceOp } from './data.ts'
import { Moon } from './Moon.tsx'

export function CellSheet({ palace, cellId, summary, onRead, onClose }: { palace: Palace; cellId: string; summary?: CellSummary; onRead: () => void; onClose: () => void }) {
  const cell = palace.cells.find(c => c.id === cellId) as Cell
  const [title, setTitle] = useState(cell.title)
  const [subtitle, setSubtitle] = useState(cell.subtitle ?? '')
  const [tab, setTab] = useState<NotebookTab>('progress')
  const [error, setError] = useState<string>()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    setTitle(cell.title)
    setSubtitle(cell.subtitle ?? '')
  }, [cell.id, cell.title, cell.subtitle])

  const run = (op: string, args: Record<string, unknown>) => palaceOp(op, { id: cell.id, ...args }).catch((e: Error) => { setError(e.message); throw e })

  const saveText = () => {
    if (title.trim() === cell.title && subtitle.trim() === (cell.subtitle ?? '')) return
    void run('updateCell', { title, subtitle: subtitle.trim() === '' ? null : subtitle }).catch(() => setTitle(cell.title))
  }
  return (
    <div className="mp-room" onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
    <aside className="mp-sheet">
      <div className="mp-sheet-head">
        <span className="mp-eyebrow">{cell.kind === 'book' ? 'READING ROOM' : 'NOTEBOOK'}</span>
        <button type="button" className="mp-sheet-close" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      {summary?.source !== undefined && <div className="mp-sheet-moon"><Moon percent={summary.percent} title={cell.title} onOpen={onRead} /></div>}
      <input className="mp-sheet-title" value={title} onChange={e => setTitle(e.target.value)} onBlur={saveText}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <input className="mp-sheet-sub" value={subtitle} placeholder={cell.kind === 'book' ? '作者' : '副标题'} onChange={e => setSubtitle(e.target.value)} onBlur={saveText}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />

      <Notebook id={cell.id} title={cell.title} subtitle={cell.subtitle} tab={tab} onTab={setTab} />

      {error && <p className="mp-error">{error}</p>}
      <div className="mp-sheet-actions">
        {cell.parentId !== null && <button type="button" className="mp-text-btn" onClick={() => void run('moveCell', { parentId: null })}>移出分组</button>}
        <button type="button" className="mp-text-btn mp-danger"
          onClick={() => (armed ? void run('deleteCell', {}).then(onClose) : setArmed(true))}
          onBlur={() => setArmed(false)}>
          {armed ? '再点一次删除（卡片也会删掉）' : '删除'}
        </button>
      </div>
    </aside>
    </div>
  )
}
