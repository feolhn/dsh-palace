/** 错题：按状态筛选、随机抽题、改章节、标记掌握。 */
import { useMemo, useState } from 'react'
import { findSection, type Library, type Material, type Mistake } from '../../shared/model.ts'
import { apiUrl, op } from '../api.ts'
import { ConfirmButton, Overlay } from './common.tsx'

type Filter = 'todo' | 'mastered' | 'all' | 'random'

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function Mistakes({ library, material: m }: { library: Library; material: Material }) {
  const [filter, setFilter] = useState<Filter>('todo')
  const [seed, setSeed] = useState(0)
  const all = library.mistakes.filter(x => x.materialId === m.id)
  const todo = all.filter(x => x.status === 'todo')
  const randomIds = useMemo(() => shuffle(todo).slice(0, 5).map(x => x.id), [seed]) // eslint-disable-line react-hooks/exhaustive-deps

  // 按目录顺序排列，同一节内按时间
  const order = new Map<string, number>()
  m.chapters.flatMap(c => c.sections).forEach((s, i) => order.set(s.id, i))
  const sorted = (items: Mistake[]) => [...items].sort((a, b) =>
    (order.get(a.sectionId ?? '') ?? 1e9) - (order.get(b.sectionId ?? '') ?? 1e9) || a.createdAt.localeCompare(b.createdAt))

  const shown = filter === 'random'
    ? randomIds.map(id => all.find(x => x.id === id)).filter((x): x is Mistake => x !== undefined)
    : sorted(filter === 'all' ? all : all.filter(x => x.status === filter))

  return (
    <div>
      <div className="dshs-chips">
        <button type="button" className={`dshs-chip ${filter === 'todo' ? 'dshs-chip-on' : ''}`} onClick={() => setFilter('todo')}>待重做 {todo.length}</button>
        <button type="button" className={`dshs-chip ${filter === 'mastered' ? 'dshs-chip-on' : ''}`} onClick={() => setFilter('mastered')}>已掌握 {all.length - todo.length}</button>
        <button type="button" className={`dshs-chip ${filter === 'all' ? 'dshs-chip-on' : ''}`} onClick={() => setFilter('all')}>全部</button>
        {todo.length > 1 && (
          <button type="button" className={`dshs-chip ${filter === 'random' ? 'dshs-chip-on' : ''}`} onClick={() => { setSeed(seed + 1); setFilter('random') }}>
            🎲 随机抽 {Math.min(5, todo.length)} 道
          </button>
        )}
      </div>

      {all.length === 0 && (
        <div className="dshs-hint">
          做错题时，把题目截图粘贴到左边对话里，说「记错题」。AI 会识别题目，记到这本书当前在学的那一节（{m.kind === 'video' ? '集' : '节'}），原图也会保存。
        </div>
      )}
      {all.length > 0 && shown.length === 0 && <div className="dshs-empty">{filter === 'todo' ? '没有待重做的错题 👍' : '这里还是空的'}</div>}

      {shown.map(x => <MistakeCard key={x.id} material={m} mistake={x} />)}
    </div>
  )
}

function MistakeCard({ material: m, mistake: x }: { material: Material; mistake: Mistake }) {
  const [showAnswer, setShowAnswer] = useState(false)
  const [zoom, setZoom] = useState(false)
  const where = findSection(m, x.sectionId)
  const image = x.image ? apiUrl('image', { name: x.image }) : undefined
  const sections = m.chapters.flatMap(c => c.sections.map(s => ({ id: s.id, label: c.title === s.title ? s.title : `${c.title} › ${s.title}` })))

  return (
    <div className={`dshs-mistake ${x.status === 'mastered' ? 'dshs-mistake-done' : ''}`}>
      <div className="dshs-row">
        <select
          className="dshs-select dshs-small"
          style={{ maxWidth: '100%', flex: 1, border: 0, padding: 0, color: 'var(--dshs-text-3)' }}
          value={where?.section.id ?? ''}
          title="改到别的章节"
          onChange={e => void op('updateMistake', { id: x.id, sectionId: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">未归类</option>
          {sections.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="dshs-badge">{x.createdAt.slice(0, 10)}</span>
      </div>
      {image && <img className="dshs-mistake-img" src={image} alt="错题原图" onClick={() => setZoom(true)} />}
      <div className="dshs-mistake-q">{x.question}</div>
      {x.note && <div className="dshs-small dshs-muted" style={{ marginTop: 6 }}>备注：{x.note}</div>}
      {x.answer && (showAnswer
        ? <div className="dshs-mistake-a">{x.answer}</div>
        : <button type="button" className="dshs-link dshs-small" style={{ marginTop: 6 }} onClick={() => setShowAnswer(true)}>看答案</button>)}
      <div className="dshs-row" style={{ marginTop: 8 }}>
        {x.status === 'todo'
          ? <button type="button" className="dshs-btn" onClick={() => void op('updateMistake', { id: x.id, status: 'mastered' })}>✓ 已掌握</button>
          : <button type="button" className="dshs-btn" onClick={() => void op('updateMistake', { id: x.id, status: 'todo' })}>放回待重做</button>}
        <span className="dshs-spacer" />
        <ConfirmButton label="删除" confirmLabel="确认删除" onConfirm={() => void op('deleteMistake', { id: x.id })} />
      </div>
      {zoom && image && <Overlay onClose={() => setZoom(false)}><img src={image} alt="错题原图" /></Overlay>}
    </div>
  )
}
