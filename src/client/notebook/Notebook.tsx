/**
 * 笔记本：一个书 / 笔记格子的内容，三个标签：进度 / 卡片 / 灵感。
 * 右侧栏（有对话，AI 功能能用）和全屏宫殿的详情里共用。
 */
import { useMemo, useRef, useState } from 'react'
import {
  findSection, paceOf, progressOf, summaryOf, today,
  type Card, type CardType, type Inspiration, type Item, type Section,
} from '../../shared/palace.ts'
import { apiUrl, openSource } from '../api.ts'
import { canChat, sendText } from '../chat.ts'
import { useItem } from '../palace/data.ts'
import { ConfirmButton, Overlay, useOp } from './common.tsx'
import { PagePicker } from './PagePicker.tsx'
import { ShareEditor } from '../share/ShareEditor.tsx'
import { EpubReader } from '../readers/EpubReader.tsx'
import { percentText } from '../palace/Moon.tsx'

export type NotebookTab = 'progress' | 'cards' | 'inspirations'

export function Notebook({ id, title, subtitle, sessionId, tab, onTab, onRead, hideTabs = false }: {
  id: string
  title: string
  /** 备注（作者、中文名……），分享卡片的出处用。 */
  subtitle?: string
  /** 右侧栏传入当前对话；全屏宫殿没有对话。 */
  sessionId?: string
  tab: NotebookTab
  onTab: (tab: NotebookTab) => void
  /** 「继续读」交给宫殿（在这一格里打开阅读器）；不给就自己弹出阅读器。 */
  onRead?: () => void
  /** 全屏阅览室里标签是画面顶上的舷窗，这里不画。 */
  hideTabs?: boolean
}) {
  const { item, error } = useItem(id)
  const [picking, setPicking] = useState(false)
  const [opError, setOpError] = useState<string>()

  if (item === undefined) return <div className="nb-muted nb-pad">{error ? `读取失败：${error}` : '加载中…'}</div>
  if (picking) return <PagePicker item={item} title={title} sessionId={sessionId} onDone={() => setPicking(false)} />

  // 笔记格子没有原文，也就没有进度
  const tabs: [NotebookTab, string][] = item.source === null && item.chapters.length === 0
    ? [['cards', '卡片'], ['inspirations', '灵感']]
    : [['progress', '进度'], ['cards', '卡片'], ['inspirations', '灵感']]
  const current = tabs.some(([t]) => t === tab) ? tab : tabs[0][0]
  const count = (t: NotebookTab) => (t === 'cards' ? item.cards.length : t === 'inspirations' ? item.inspirations.length : undefined)

  return (
    <div className="nb">
      {!hideTabs && <div className="nb-tabs">
        {tabs.map(([t, label]) => (
          <button key={t} type="button" className={current === t ? 'nb-on' : ''} onClick={() => onTab(t)}>
            {label}{count(t) ? <small>{count(t)}</small> : null}
          </button>
        ))}
      </div>}
      {opError && <div className="nb-error" onClick={() => setOpError(undefined)}>{opError}</div>}
      {current === 'progress' && <ProgressTab key={item.targetDate ?? ''} item={item} title={title} subtitle={subtitle} onPick={() => setPicking(true)} onRead={onRead} onError={setOpError} />}
      {current === 'cards' && <CardsTab item={item} title={title} subtitle={subtitle} onError={setOpError} />}
      {current === 'inspirations' && <InspirationsTab item={item} title={title} sessionId={sessionId} onError={setOpError} />}
    </div>
  )
}

// ---------- 进度 ----------

/** 目标日期按设计稿显示成 YYYY.MM.DD。 */
const dotted = (d?: string) => (d ?? '').replaceAll('-', '.')

function ProgressTab({ item, title, subtitle, onPick, onRead, onError }: { item: Item; title: string; subtitle?: string; onPick: () => void; onRead?: () => void; onError: (m: string) => void }) {
  const run = useOp(onError)
  const [reading, setReading] = useState(false)
  const p = progressOf(item)
  const pace = paceOf(item)
  const finished = item.finishedAt !== undefined
  const percent = summaryOf(item).percent
  const video = item.source?.type === 'video'
  const unit = video ? '集' : '节'
  const picker = useRef<HTMLInputElement>(null)
  const saveDate = (value: string) => { if (value !== (item.targetDate ?? '')) void run('updateItem', { id: item.id, targetDate: value || null }) }

  let paceText = ''
  if (!finished && pace !== undefined && p.total > 0) {
    if (pace.remaining === 0) paceText = '已经学完了'
    else if (pace.daysLeft <= 0) paceText = `已过目标日期，还剩 ${pace.remaining} ${unit}`
    else paceText = `还剩 ${pace.daysLeft} 天 · 每天约 ${pace.perDay} ${unit}`
  }
  const current = p.current && (p.current.chapter.title === p.current.section.title ? p.current.section.title : `${p.current.chapter.title} › ${p.current.section.title}`)

  return (
    <div className="nb-section nb-progress">
      {/* 设计稿 #40：左边大号百分比 + 正在读哪里，右边目标完成日期 */}
      <div className="nb-journey">
        <div className="nb-journey-main">
          <span className="nb-eyebrow">THE JOURNEY</span>
          <p className="nb-pct">{finished ? '已读完' : percent !== undefined ? percentText(percent) : '尚未记录进度'}</p>
          <small>{current !== undefined && !finished ? `${p.done === 0 ? '从这里开始' : '接下来'} · ${current}` : '每一页，都是走过的一小段路。'}</small>
        </div>
        {/* 点日期弹出系统日历（和原来一样），显示按设计稿写成 YYYY.MM.DD */}
        <div className="nb-target">目标完成日期
          <button type="button" className={item.targetDate ? '' : 'nb-target-empty'}
            onClick={() => { const el = picker.current; if (!el) return; try { el.showPicker() } catch { el.focus(); el.click() } }}>
            {item.targetDate ? dotted(item.targetDate) : 'YYYY.MM.DD'}
          </button>
          <input ref={picker} type="date" className="nb-target-picker" tabIndex={-1} aria-label="目标完成日期" value={item.targetDate ?? ''} onChange={e => saveDate(e.target.value)} />
          {paceText !== '' && <small className={pace?.overdue ? 'nb-danger' : undefined}>{paceText}</small>}
        </div>
      </div>

      {item.source?.type === 'epub' && (
        <div className="nb-row">
          <button type="button" className="nb-btn" onClick={() => (onRead ? onRead() : setReading(true))}>{item.position ? '继续读' : '开始读'}</button>
        </div>
      )}
      {reading && <EpubReader item={item} title={title} subtitle={subtitle} onClose={() => setReading(false)} />}
      {item.source !== null && item.source.type !== 'epub' && (
        <div className="nb-row">
          <button type="button" className="nb-btn" onClick={() => void openSource(item.id, video ? p.current?.section.id : undefined).catch((e: Error) => onError(e.message))}>
            {video ? (p.current ? '继续看' : '打开视频') : item.source.type === 'pdf' ? '打开 PDF' : '打开原文'}
          </button>
        </div>
      )}

      {item.chapters.length === 0
        ? (
          <div className="nb-empty">
            <p>还没有目录。</p>
            {item.source?.type === 'epub' && <p className="nb-small nb-muted">第一次打开阅读时，会自动读出书里的目录。</p>}
            {item.source?.type === 'pdf' && (
              <>
                <p className="nb-small nb-muted">这本 PDF 没有书签。勾选目录所在的页面，AI 会读出章节结构。</p>
                <button type="button" className="nb-btn nb-primary" onClick={onPick}>勾选目录页</button>
              </>
            )}
          </div>
        )
        : <Outline item={item} currentId={p.current?.section.id} onError={onError} />}

      <div className="nb-progress-foot">
        {p.total > 0 && <span>{p.done} / {p.total} 章节已读</span>}
        <span className="nb-spacer" />
        {item.source?.type === 'pdf' && item.chapters.length > 0 && <button type="button" className="nb-link" onClick={onPick}>重新生成目录</button>}
        {p.done > 0 && <ConfirmButton label="重置进度" confirmLabel="确认清空全部打勾？" onConfirm={() => void run('resetProgress', { id: item.id })} />}
        <button type="button" className="nb-link" onClick={() => void run('updateItem', { id: item.id, finishedAt: finished ? null : today() })}>{finished ? '重新标为在读 ↺' : '标记读完 ○'}</button>
      </div>
    </div>
  )
}

function Outline({ item, currentId, onError }: { item: Item; currentId?: string; onError: (m: string) => void }) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const single = item.chapters.length === 1
  return (
    <div className="nb-outline">
      {item.chapters.map((c) => {
        const flat = c.sections.length === 1 && c.sections[0].title === c.title
        if (flat) return <SectionRow key={c.id} item={item} section={c.sections[0]} current={c.sections[0].id === currentId} onError={onError} />
        const done = c.sections.filter(s => s.done).length
        // 默认展开当前章；章少时全部展开
        const open = openMap[c.id] ?? (single || item.chapters.length <= 3 || c.sections.some(s => s.id === currentId))
        return (
          <div key={c.id}>
            {!single && (
              <button type="button" className="nb-chapter" onClick={() => setOpenMap({ ...openMap, [c.id]: !open })}>
                <span>{open ? '▾' : '▸'}</span>{c.title}<small>{done}/{c.sections.length}</small>
              </button>
            )}
            {open && c.sections.map(s => <SectionRow key={s.id} item={item} section={s} current={s.id === currentId} indent={!single} onError={onError} />)}
          </div>
        )
      })}
    </div>
  )
}

function SectionRow({ item, section: s, current, indent = false, onError }: { item: Item; section: Section; current: boolean; indent?: boolean; onError: (m: string) => void }) {
  const run = useOp(onError)
  const toggle = () => void run('setSectionDone', { id: item.id, sectionId: s.id, done: !s.done })
  const video = item.source?.type === 'video'
  return (
    <div className={`nb-sec ${s.done ? 'nb-done' : ''} ${current ? 'nb-cur' : ''} ${indent ? 'nb-indent' : ''}`}>
      <input type="checkbox" checked={s.done} onChange={toggle} />
      <span className="nb-sec-title" onClick={toggle}>{s.title}</span>
      {/* 「学到这里」：鼠标移到哪一节，就在那一节旁边出现一个白色向下三角（#40） */}
      <span className="nb-sec-actions">
        <button type="button" className="nb-upto" title="学到这里：这一节及之前都标记为已读" aria-label={`学到这里：${s.title}`} onClick={() => void run('markUpTo', { id: item.id, sectionId: s.id })}><i /></button>
        {video && s.loc && <button type="button" className="nb-link" onClick={() => void openSource(item.id, s.id).catch((e: Error) => onError(e.message))}>播放</button>}
      </span>
      <span className="nb-spacer" />
      {item.source?.type === 'pdf' && s.loc && <small className="nb-muted">p{s.loc}</small>}
    </div>
  )
}

// ---------- 卡片 ----------

type Filter = 'all' | CardType | 'random'
const TYPE_LABEL: Record<CardType, string> = { excerpt: '摘录', thought: '想法', mistake: '错题' }

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function CardsTab({ item, title, subtitle, onError }: { item: Item; title: string; subtitle?: string; onError: (m: string) => void }) {
  const run = useOp(onError)
  const [filter, setFilter] = useState<Filter>('all')
  const [seed, setSeed] = useState(0)
  const [draft, setDraft] = useState('')
  const todo = item.cards.filter(k => k.type === 'mistake' && k.status === 'todo')
  const randomIds = useMemo(() => shuffle(todo).slice(0, 5).map(k => k.id), [seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const types = (['excerpt', 'thought', 'mistake'] as const).filter(t => item.cards.some(k => k.type === t))

  const shown = filter === 'random'
    ? randomIds.map(id => item.cards.find(k => k.id === id)).filter((k): k is Card => k !== undefined)
    : [...item.cards].reverse().filter(k => filter === 'all' || k.type === filter)

  const addThought = () => {
    if (draft.trim() === '') return
    void run('addCard', { id: item.id, type: 'thought', note: draft, sectionId: progressOf(item).current?.section.id }).then(ok => { if (ok) setDraft('') })
  }

  return (
    <div className="nb-section">
      <div className="nb-compose">
        <textarea value={draft} placeholder="写下一个想法…（⌘ + 回车保存）" rows={2} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addThought() }} />
        {draft.trim() !== '' && <button type="button" className="nb-btn nb-primary" onClick={addThought}>保存</button>}
      </div>

      {(types.length > 1 || todo.length > 1) && (
        <div className="nb-chips">
          <button type="button" className={filter === 'all' ? 'nb-on' : ''} onClick={() => setFilter('all')}>全部</button>
          {types.length > 1 && types.map(t => <button key={t} type="button" className={filter === t ? 'nb-on' : ''} onClick={() => setFilter(t)}>{TYPE_LABEL[t]}</button>)}
          {todo.length > 1 && <button type="button" className={filter === 'random' ? 'nb-on' : ''} onClick={() => { setSeed(seed + 1); setFilter('random') }}>随机抽 {Math.min(5, todo.length)} 道错题</button>}
        </div>
      )}

      {item.cards.length === 0 && (
        <p className="nb-hint">
          随手记下的想法、读到的好句子、做错的题，都是卡片。<br />
          在左边对话里粘贴错题截图说「记错题」，或者把一段原文发给 AI 说「摘录下来」，AI 会记到这里当前在读的那一节。
        </p>
      )}
      <div className="nb-cards">
        {shown.map(k => <CardView key={k.id} item={item} card={k} title={title} subtitle={subtitle} onError={onError} />)}
      </div>
    </div>
  )
}

function CardView({ item, card: k, title, subtitle, onError }: { item: Item; card: Card; title: string; subtitle?: string; onError: (m: string) => void }) {
  const [sharing, setSharing] = useState(false)
  const run = useOp(onError)
  const [showAnswer, setShowAnswer] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [editing, setEditing] = useState<string>()
  const where = findSection(item, k.sectionId)
  const image = k.image ? apiUrl('image', { name: k.image }) : undefined
  const sections = item.chapters.flatMap(c => c.sections.map(s => ({ id: s.id, label: c.title === s.title ? s.title : `${c.title} › ${s.title}` })))
  const saveNote = () => {
    if (editing === undefined) return
    void run('updateCard', { id: item.id, cardId: k.id, note: editing.trim() === '' ? null : editing }).then(ok => { if (ok) setEditing(undefined) })
  }

  return (
    <article className={`nb-card nb-${k.type} ${k.status === 'mastered' ? 'nb-mastered' : ''}`}>
      <header className="nb-row nb-small nb-muted">
        <span>{TYPE_LABEL[k.type]}{k.type === 'mistake' && k.status === 'mastered' ? ' · 已掌握' : ''}</span>
        {sections.length > 0
          ? (
            <select value={where?.section.id ?? ''} title="改到别的章节" onChange={e => void run('updateCard', { id: item.id, cardId: k.id, sectionId: e.target.value === '' ? null : e.target.value })}>
              <option value="">未归类</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )
          : <span className="nb-spacer" />}
        <span>{k.createdAt.slice(5, 10).replace('-', '.')}</span>
      </header>
      {image && <img className="nb-card-img" src={image} alt="原图" onClick={() => setZoom(true)} />}
      {k.quote && <blockquote>{k.quote}</blockquote>}
      {editing !== undefined
        ? (
          <div className="nb-compose">
            <textarea autoFocus value={editing} rows={3} onChange={e => setEditing(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote(); if (e.key === 'Escape') setEditing(undefined) }} />
            <div className="nb-row">
              <button type="button" className="nb-btn nb-primary" onClick={saveNote}>保存</button>
              <button type="button" className="nb-link" onClick={() => setEditing(undefined)}>取消</button>
            </div>
          </div>
        )
        : k.note && <p className="nb-note">{k.note}</p>}
      {k.answer && (showAnswer
        ? <p className="nb-answer">{k.answer}</p>
        : <button type="button" className="nb-link" onClick={() => setShowAnswer(true)}>看答案</button>)}
      <footer className="nb-row">
        {k.type === 'mistake' && (
          <button type="button" className="nb-link" onClick={() => void run('updateCard', { id: item.id, cardId: k.id, status: k.status === 'mastered' ? 'todo' : 'mastered' })}>
            {k.status === 'mastered' ? '放回待重做' : '已掌握'}
          </button>
        )}
        {editing === undefined && <button type="button" className="nb-link" onClick={() => setEditing(k.note ?? '')}>{k.note ? '改想法' : '写想法'}</button>}
        {k.type !== 'mistake' && (k.quote || k.note) && <button type="button" className="nb-link" onClick={() => setSharing(true)}>分享</button>}
        <span className="nb-spacer" />
        <ConfirmButton label="删除" confirmLabel="确认删除" onConfirm={() => void run('deleteCard', { id: item.id, cardId: k.id })} />
      </footer>
      {sharing && <ShareEditor itemId={item.id} card={k} title={title} subtitle={subtitle} onClose={() => setSharing(false)} />}
      {zoom && image && <Overlay onClose={() => setZoom(false)}><img src={image} alt="原图" /></Overlay>}
    </article>
  )
}

// ---------- 灵感 ----------

function InspirationsTab({ item, title, sessionId, onError }: { item: Item; title: string; sessionId?: string; onError: (m: string) => void }) {
  const chatOk = canChat(sessionId)
  const [sent, setSent] = useState(false)
  const save = () => {
    if (!chatOk) return
    sendText(sessionId, `请把我们这次对话总结成一条灵感，存到《${title}》（item_id: ${item.id}）。`)
      .then(() => setSent(true), (e: Error) => onError(e.message))
  }
  return (
    <div className="nb-section">
      {chatOk
        ? (
          <div className="nb-row">
            <button type="button" className="nb-btn nb-btn-small" onClick={save}>把这次对话存成灵感</button>
            {sent && <span className="nb-small nb-muted">已经请 AI 总结，稍等片刻</span>}
          </div>
        )
        : <p className="nb-hint">和 AI 聊完后一键存成灵感：在全屏宫殿点右下角「AI」打开这本书的对话，或在对话旁边打开这个笔记本（对话标题栏右侧的按钮）。</p>}
      {item.inspirations.length === 0 && chatOk && (
        <p className="nb-hint">和 AI 聊完这本书，点上面的按钮，或者直接说「存成灵感」。AI 会把你的想法总结成一篇短文放在这里。</p>
      )}
      {[...item.inspirations].reverse().map(i => <InspirationView key={i.id} item={item} insp={i} onError={onError} />)}
    </div>
  )
}

function InspirationView({ item, insp, onError }: { item: Item; insp: Inspiration; onError: (m: string) => void }) {
  const run = useOp(onError)
  return (
    <article className="nb-insp">
      <header className="nb-row">
        <h3>{insp.title}</h3>
        <span className="nb-spacer" />
        <span className="nb-small nb-muted">{insp.createdAt.slice(0, 10)}</span>
      </header>
      <div className="nb-insp-body">{insp.body}</div>
      <footer className="nb-row">
        <span className="nb-spacer" />
        <ConfirmButton label="删除" confirmLabel="确认删除" onConfirm={() => void run('deleteInspiration', { id: item.id, inspirationId: insp.id })} />
      </footer>
    </article>
  )
}
