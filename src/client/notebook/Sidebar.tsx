/**
 * 右侧栏（和对话并排）：先选一个格子，再看它的笔记本。
 * 460 宽放不下画布，所以这里是一个简单的列表；整理宫殿去全屏。
 */
import { useEffect, useState } from 'react'
import type { Cell } from '../../shared/palace.ts'
import { setActive } from '../api.ts'
import { usePalace } from '../palace/data.ts'
import { Notebook, type NotebookTab } from './Notebook.tsx'

interface View { id?: string; tab: NotebookTab }

/** 每个对话记住自己打开的是哪个格子（切换对话、收起侧栏再打开都不丢）。 */
const remembered = new Map<string, View>()

export function Sidebar({ sessionId }: { sessionId?: string }) {
  const key = sessionId ?? '__none__'
  const [view, setViewState] = useState<View>(() => remembered.get(key) ?? { tab: 'progress' })
  const setView = (next: View) => { remembered.set(key, next); setViewState(next) }
  const { palace, summaries, error } = usePalace()
  const cells = palace?.cells ?? []
  const cell = view.id !== undefined ? cells.find(c => c.id === view.id) : undefined

  // 告诉 Host：这个对话当前打开的是哪个格子（AI 记卡片、存灵感时默认记到这里）
  const activeId = cell?.id ?? null
  useEffect(() => {
    if (sessionId !== undefined) void setActive(sessionId, activeId).catch(() => undefined)
  }, [sessionId, activeId])

  if (palace === undefined) return <div className="nb-root nb-pad nb-muted">{error ? `加载失败：${error}` : '加载中…'}</div>

  if (cell !== undefined) {
    const group = cell.parentId !== null ? cells.find(c => c.id === cell.parentId) : undefined
    return (
      <div className="nb-root">
        <button type="button" className="nb-link nb-back" onClick={() => setView({ tab: view.tab })}>← {group?.title ?? '全部'}</button>
        <h2 className="nb-title">{cell.title}</h2>
        {cell.subtitle && <div className="nb-subtitle">{cell.subtitle}</div>}
        <Notebook id={cell.id} title={cell.title} subtitle={cell.subtitle} sessionId={sessionId} tab={view.tab} onTab={tab => setView({ ...view, tab })} />
      </div>
    )
  }

  const roots = cells.filter(c => c.parentId === null).sort(byPosition)
  const row = (c: Cell) => {
    const s = summaries[c.id]
    const meta = s === undefined ? '' : s.finished ? '读完了' : s.total > 0 ? `${s.done}/${s.total}` : s.cards > 0 ? `${s.cards} 张卡片` : ''
    return (
      <button key={c.id} type="button" className="nb-item" onClick={() => setView({ id: c.id, tab: view.tab })}>
        <span>{c.title}{c.subtitle && <small>{c.subtitle}</small>}</span>
        <span className="nb-muted nb-small">{meta}</span>
      </button>
    )
  }

  return (
    <div className="nb-root">
      <h2 className="nb-title nb-wordmark">Memory Palace</h2>
      {roots.length === 0 && <p className="nb-hint">宫殿还是空的。点左侧导航的「Memory Palace」放进第一本书，或者直接在对话里说「把这本 PDF 放进宫殿：/完整路径/书.pdf」。</p>}
      <div className="nb-list">
        {roots.map(c => (c.kind === 'group'
          ? (
            <div key={c.id} className="nb-group">
              <div className="nb-group-title">{c.title}</div>
              {cells.filter(x => x.parentId === c.id).sort(byPosition).map(row)}
            </div>
          )
          : row(c)))}
      </div>
    </div>
  )
}

/** 和画布上一样的顺序：先行后列。 */
function byPosition(a: Cell, b: Cell): number {
  return a.row - b.row || a.col - b.col
}
