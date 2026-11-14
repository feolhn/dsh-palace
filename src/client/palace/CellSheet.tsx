/**
 * 点开书 / 笔记格子后的详情：改名、作者 / 副标题、目标日期、移出分组、删除。
 * 下一步（#5）这里会换成完整的笔记本（进度 / 卡片 / 灵感）。
 */
import { useEffect, useState } from 'react'
import type { Cell, CellSummary, Item, Palace } from '../../shared/palace.ts'
import { getItem, palaceOp } from './data.ts'

export function CellSheet({ palace, cellId, summary, onClose }: { palace: Palace; cellId: string; summary?: CellSummary; onClose: () => void }) {
  const cell = palace.cells.find(c => c.id === cellId) as Cell
  const [item, setItem] = useState<Item>()
  const [title, setTitle] = useState(cell.title)
  const [subtitle, setSubtitle] = useState(cell.subtitle ?? '')
  const [targetDate, setTargetDate] = useState('')
  const [error, setError] = useState<string>()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    setTitle(cell.title)
    setSubtitle(cell.subtitle ?? '')
    getItem(cell.id).then((it) => { setItem(it); setTargetDate(it.targetDate ?? '') }).catch((e: Error) => setError(e.message))
  }, [cell.id, cell.title, cell.subtitle])

  const run = (op: string, args: Record<string, unknown>) => palaceOp(op, { id: cell.id, ...args }).catch((e: Error) => { setError(e.message); throw e })

  const saveText = () => {
    if (title.trim() === cell.title && subtitle.trim() === (cell.subtitle ?? '')) return
    void run('updateCell', { title, subtitle: subtitle.trim() === '' ? null : subtitle }).catch(() => setTitle(cell.title))
  }
  const saveDate = () => {
    if (targetDate === (item?.targetDate ?? '')) return
    void run('updateItem', { targetDate: targetDate === '' ? null : targetDate })
  }

  const source = item?.source
  return (
    <aside className="mp-sheet" onPointerDown={e => e.stopPropagation()}>
      <div className="mp-sheet-head">
        <span className="mp-eyebrow">{cell.kind === 'book' ? '书' : '笔记'}</span>
        <button type="button" className="mp-text-btn" onClick={onClose}>关闭</button>
      </div>
      <input className="mp-sheet-title" value={title} onChange={e => setTitle(e.target.value)} onBlur={saveText}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <input className="mp-sheet-sub" value={subtitle} placeholder={cell.kind === 'book' ? '作者' : '副标题'} onChange={e => setSubtitle(e.target.value)} onBlur={saveText}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />

      <dl className="mp-facts">
        {source?.type === 'pdf' && <><dt>原文</dt><dd>PDF · {source.pageCount} 页</dd></>}
        {source?.type === 'video' && <><dt>原文</dt><dd>视频课</dd></>}
        {summary !== undefined && summary.total > 0 && <><dt>进度</dt><dd>{summary.done} / {summary.total} 节{summary.perDay ? ` · 每天约 ${summary.perDay} 节` : ''}{summary.overdue ? ' · 已过目标日期' : ''}</dd></>}
        {summary !== undefined && <><dt>卡片</dt><dd>{summary.cards} 张</dd></>}
        {cell.kind === 'book' && (
          <>
            <dt>目标日期</dt>
            <dd><input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} onBlur={saveDate} /></dd>
          </>
        )}
      </dl>

      <p className="mp-hint">笔记本（进度 / 卡片 / 灵感）在下一步做。</p>

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
  )
}
