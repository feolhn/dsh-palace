/** 资料详情：进度、节奏、目录勾选、错题、设置。 */
import { useState } from 'react'
import { paceOf, progressOf, type Library, type Material, type Section } from '../../shared/model.ts'
import { op, openTarget } from '../api.ts'
import { ConfirmButton, Progress, TextForm, useAction } from './common.tsx'
import { Mistakes } from './Mistakes.tsx'

export type MaterialTab = 'outline' | 'mistakes' | 'settings'

export function MaterialView({ library, material: m, tab, onTab, onBack, onPick }: {
  library: Library
  material: Material
  tab: MaterialTab
  onTab: (tab: MaterialTab) => void
  onBack: () => void
  onPick: () => void
}) {
  const p = progressOf(m)
  const unit = m.kind === 'video' ? '集' : '节'
  const subject = library.subjects.find(s => s.id === m.subjectId)
  const mistakes = library.mistakes.filter(x => x.materialId === m.id)
  const todo = mistakes.filter(x => x.status === 'todo').length
  const { error, run } = useAction()

  return (
    <div>
      <button type="button" className="dshs-link dshs-back" onClick={onBack}>← 书架</button>
      <div className="dshs-small dshs-muted">{subject?.name} · {m.kind === 'book' ? `教材${m.pageCount ? ` · ${m.pageCount} 页` : ''}` : '视频课'}</div>
      <h2 className="dshs-title">{m.title}</h2>

      <div className="dshs-row" style={{ marginTop: 12, alignItems: 'baseline' }}>
        <span className="dshs-stat">{p.done} / {p.total}</span>
        <span className="dshs-muted">{unit}</span>
        <span className="dshs-spacer" />
        <span className="dshs-muted">{p.total === 0 ? '' : `${Math.round((p.done / p.total) * 100)}%`}</span>
      </div>
      <Progress done={p.done} total={p.total} />
      <PaceLine material={m} onSet={() => onTab('settings')} />

      {p.current && (
        <div className="dshs-current">
          <div className="dshs-small dshs-muted">{p.done === 0 ? '从这里开始' : '接下来'}</div>
          <div className="dshs-current-title">{p.current.chapter.title === p.current.section.title ? p.current.section.title : `${p.current.chapter.title} › ${p.current.section.title}`}</div>
        </div>
      )}

      <div className="dshs-row" style={{ marginTop: 12 }}>
        {m.kind === 'book'
          ? <button type="button" className="dshs-btn dshs-btn-primary" onClick={() => void run(() => openTarget(m.id))}>打开 PDF 学习</button>
          : <button type="button" className="dshs-btn dshs-btn-primary" onClick={() => void run(() => openTarget(m.id, p.current?.section.id))}>{p.current ? `继续看：${p.current.section.title.slice(0, 16)}` : '打开视频'}</button>}
      </div>
      {error && <div className="dshs-error">{error}</div>}

      <div className="dshs-tabs">
        <button type="button" className={`dshs-tab ${tab === 'outline' ? 'dshs-tab-on' : ''}`} onClick={() => onTab('outline')}>{m.kind === 'video' ? '视频列表' : '目录'}</button>
        <button type="button" className={`dshs-tab ${tab === 'mistakes' ? 'dshs-tab-on' : ''}`} onClick={() => onTab('mistakes')}>错题{todo > 0 ? ` ${todo}` : ''}</button>
        <button type="button" className={`dshs-tab ${tab === 'settings' ? 'dshs-tab-on' : ''}`} onClick={() => onTab('settings')}>设置</button>
      </div>

      {tab === 'outline' && <Outline material={m} currentId={p.current?.section.id} onPick={onPick} />}
      {tab === 'mistakes' && <Mistakes library={library} material={m} />}
      {tab === 'settings' && <Settings library={library} material={m} onPick={onPick} onDeleted={onBack} />}
    </div>
  )
}

function PaceLine({ material: m, onSet }: { material: Material; onSet: () => void }) {
  const pace = paceOf(m)
  if (pace === undefined) {
    return <div className="dshs-pace dshs-small">没有目标日期 · <button type="button" className="dshs-link" onClick={onSet}>设一个</button></div>
  }
  if (pace.remaining === 0) return <div className="dshs-pace dshs-small">🎉 已经学完了</div>
  if (pace.daysLeft <= 0) return <div className="dshs-pace dshs-small dshs-pace-warn">目标日期 {m.targetDate} 已过，还剩 {pace.remaining} 节 · <button type="button" className="dshs-link" onClick={onSet}>改日期</button></div>
  return (
    <div className="dshs-pace dshs-small">
      目标 {m.targetDate} · 还剩 {pace.daysLeft} 天、{pace.remaining} {m.kind === 'video' ? '集' : '节'} · <b>每天约 {pace.perDay} {m.kind === 'video' ? '集' : '节'}</b>
    </div>
  )
}

function Outline({ material: m, currentId, onPick }: { material: Material; currentId?: string; onPick: () => void }) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  if (m.chapters.length === 0) {
    return (
      <div className="dshs-empty">
        <p className="dshs-title">还没有目录</p>
        <p>这本 PDF 没有书签。勾选目录所在的页面，AI 会读出章节结构。</p>
        <button type="button" className="dshs-btn dshs-btn-primary" onClick={onPick}>勾选目录页</button>
        <p className="dshs-small" style={{ marginTop: 12 }}>也可以直接在对话里说：「《{m.title}》的目录在第 5 到 12 页，帮我生成目录」</p>
      </div>
    )
  }
  const single = m.chapters.length === 1
  return (
    <div>
      {m.chapters.map((c) => {
        const done = c.sections.filter(s => s.done).length
        const hasCurrent = c.sections.some(s => s.id === currentId)
        // 默认展开当前章；其余折叠（章节多时不至于太长）
        const open = openMap[c.id] ?? (single || hasCurrent || m.chapters.length <= 3)
        const flat = c.sections.length === 1 && c.sections[0].title === c.title
        if (flat) return <SectionRow key={c.id} material={m} section={c.sections[0]} current={c.sections[0].id === currentId} indent={false} />
        return (
          <div key={c.id} className="dshs-chapter">
            {!single && (
              <button type="button" className="dshs-chapter-head" onClick={() => setOpenMap({ ...openMap, [c.id]: !open })}>
                <span className="dshs-caret">{open ? '▼' : '▶'}</span>
                <span className="dshs-chapter-title">{c.title}</span>
                <span className="dshs-badge">{done}/{c.sections.length}</span>
              </button>
            )}
            {open && c.sections.map(s => <SectionRow key={s.id} material={m} section={s} current={s.id === currentId} indent={!single} />)}
          </div>
        )
      })}
    </div>
  )
}

function SectionRow({ material: m, section: s, current, indent }: { material: Material; section: Section; current: boolean; indent: boolean }) {
  const toggle = () => void op('setSectionDone', { materialId: m.id, sectionId: s.id, done: !s.done })
  return (
    <div className={`dshs-sec ${s.done ? 'dshs-sec-done' : ''} ${current ? 'dshs-sec-current' : ''}`} style={indent ? undefined : { paddingLeft: 4 }}>
      <input type="checkbox" checked={s.done} onChange={toggle} />
      <span className="dshs-sec-title" onClick={toggle}>{s.title}</span>
      <span className="dshs-sec-actions">
        <button type="button" className="dshs-link dshs-small" title="这一节及之前都标记为已完成" onClick={() => void op('markUpTo', { materialId: m.id, sectionId: s.id })}>学到这里</button>
        {s.url && <button type="button" className="dshs-link dshs-small" onClick={() => void openTarget(m.id, s.id)}>▶ 播放</button>}
      </span>
      {s.page !== undefined && <span className="dshs-badge">p{s.page}</span>}
    </div>
  )
}

function Settings({ library, material: m, onPick, onDeleted }: { library: Library; material: Material; onPick: () => void; onDeleted: () => void }) {
  const [date, setDate] = useState(m.targetDate ?? '')
  const [renaming, setRenaming] = useState(false)
  const { busy, error, run } = useAction()
  const goalName = (goalId: string) => library.goals.find(g => g.id === goalId)?.name ?? ''
  return (
    <div className="dshs-menu dshs-section">
      <div className="dshs-row">
        <span className="dshs-label" style={{ width: 72, margin: 0 }}>目标日期</span>
        <input className="dshs-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <button type="button" className="dshs-btn" disabled={busy || date === (m.targetDate ?? '')} onClick={() => void run(() => op('updateMaterial', { id: m.id, targetDate: date || null }))}>保存</button>
      </div>
      <div className="dshs-row">
        <span className="dshs-label" style={{ width: 72, margin: 0 }}>科目</span>
        <select className="dshs-select" value={m.subjectId} onChange={e => void run(() => op('updateMaterial', { id: m.id, subjectId: e.target.value }))}>
          {library.subjects.map(s => <option key={s.id} value={s.id}>{goalName(s.goalId)} · {s.name}</option>)}
        </select>
      </div>
      {renaming
        ? <TextForm initial={m.title} submitLabel="改名" onSubmit={title => op('updateMaterial', { id: m.id, title })} onCancel={() => setRenaming(false)} />
        : <div className="dshs-row"><button type="button" className="dshs-btn" onClick={() => setRenaming(true)}>改名</button></div>}
      {m.kind === 'book' && (
        <div className="dshs-row">
          <button type="button" className="dshs-btn" onClick={onPick}>{m.chapters.length === 0 ? '勾选目录页生成目录' : '重新生成目录'}</button>
          {m.chapters.length > 0 && <span className="dshs-small dshs-muted">标题不变的节会保留完成状态</span>}
        </div>
      )}
      <div className="dshs-row">
        <ConfirmButton label="重置进度" confirmLabel="确认清空全部进度？" onConfirm={() => void run(() => op('resetProgress', { materialId: m.id }))} />
        <ConfirmButton label="从书架删除" confirmLabel="确认删除？（错题也会删除）" onConfirm={() => void run(async () => { await op('deleteMaterial', { id: m.id }); onDeleted() })} />
      </div>
      {m.file && <div className="dshs-small dshs-muted" style={{ wordBreak: 'break-all' }}>文件：{m.file}<br />从书架删除不会删除这个文件。</div>}
      {m.url && <div className="dshs-small dshs-muted" style={{ wordBreak: 'break-all' }}>链接：{m.url}</div>}
      {error && <div className="dshs-error">{error}</div>}
    </div>
  )
}
