/** 书架首页：学习目标 › 科目 › 资料封面。 */
import { useState } from 'react'
import { daysBetween, paceOf, progressOf, today, type Goal, type Library, type Material } from '../../shared/model.ts'
import { op } from '../api.ts'
import { ConfirmButton, coverColor, TextForm } from './common.tsx'

const GOAL_KEY = 'dsh-shelf:goal'
const SUBJECT_KEY = 'dsh-shelf:subject'

function load(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined } catch { return undefined }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 隐私模式 */ }
}

export function Home({ library, onOpen, onAdd }: {
  library: Library
  onOpen: (materialId: string) => void
  onAdd: (subjectId: string | undefined) => void
}) {
  const [goalId, setGoalId] = useState(load(GOAL_KEY))
  const [subjectId, setSubjectId] = useState(load(SUBJECT_KEY) ?? 'all')
  const [editing, setEditing] = useState<'newGoal' | 'editGoal' | 'newSubject' | 'renameSubject'>()

  const goal = library.goals.find(g => g.id === goalId) ?? library.goals[0]
  if (goal === undefined) return <Welcome />

  const subjects = library.subjects.filter(s => s.goalId === goal.id)
  const subject = subjects.find(s => s.id === subjectId)
  const materials = library.materials.filter(m => (subject ? m.subjectId === subject.id : subjects.some(s => s.id === m.subjectId)))
  const pickGoal = (id: string) => { setGoalId(id); save(GOAL_KEY, id); pickSubject('all') }
  const pickSubject = (id: string) => { setSubjectId(id); save(SUBJECT_KEY, id) }

  return (
    <div>
      <div className="dshs-goalbar">
        <select className="dshs-goal-select" value={goal.id} onChange={e => (e.target.value === '+' ? setEditing('newGoal') : pickGoal(e.target.value))}>
          {library.goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="+">＋ 新建学习目标…</option>
        </select>
        <ExamCountdown goal={goal} />
        <span className="dshs-spacer" />
        <button type="button" className="dshs-link dshs-small" onClick={() => setEditing(editing === 'editGoal' ? undefined : 'editGoal')}>编辑</button>
      </div>

      {editing === 'newGoal' && <GoalForm onDone={(id) => { setEditing(undefined); if (id) pickGoal(id) }} />}
      {editing === 'editGoal' && <GoalForm goal={goal} onDone={() => setEditing(undefined)} />}

      <div className="dshs-chips">
        {subjects.length > 0 && (
          <button type="button" className={`dshs-chip ${subject === undefined ? 'dshs-chip-on' : ''}`} onClick={() => pickSubject('all')}>全部</button>
        )}
        {subjects.map(s => (
          <button key={s.id} type="button" className={`dshs-chip ${subject?.id === s.id ? 'dshs-chip-on' : ''}`}
            onClick={() => pickSubject(s.id)} onDoubleClick={() => setEditing('renameSubject')}>
            {s.name}
          </button>
        ))}
        <button type="button" className="dshs-chip" onClick={() => setEditing('newSubject')}>＋ 科目</button>
      </div>

      {editing === 'newSubject' && (
        <TextForm placeholder="科目名称，如：刑法" submitLabel="添加科目"
          onSubmit={async (name) => {
            const s = await op<{ id: string }>('addSubject', { goalId: goal.id, name })
            pickSubject(s.id)
          }}
          onCancel={() => setEditing(undefined)} />
      )}
      {editing === 'renameSubject' && subject && (
        <TextForm initial={subject.name} submitLabel="改名"
          onSubmit={name => op('updateSubject', { id: subject.id, name })}
          onCancel={() => setEditing(undefined)}
          extra={<div className="dshs-row"><ConfirmButton label="删除这个科目（含其中资料和错题）" onConfirm={() => { void op('deleteSubject', { id: subject.id }); pickSubject('all'); setEditing(undefined) }} /></div>} />
      )}

      {subjects.length === 0
        ? (
            <div className="dshs-empty">
              <p className="dshs-title">先添加一个科目</p>
              <p>比如法考的刑法、民法；考研的数学、英语。</p>
            </div>
          )
        : (
            <>
              {subject && <div className="dshs-small dshs-muted" style={{ marginTop: 8 }}>双击科目可以改名或删除</div>}
              <div className="dshs-grid">
                {materials.map(m => <BookCard key={m.id} material={m} subjectName={subject ? undefined : subjects.find(s => s.id === m.subjectId)?.name} onOpen={() => onOpen(m.id)} />)}
                <button type="button" className="dshs-book" onClick={() => onAdd(subject?.id)}>
                  <div className="dshs-add-card"><b>＋</b>添加教材或视频课</div>
                </button>
              </div>
            </>
          )}
    </div>
  )
}

function ExamCountdown({ goal }: { goal: Goal }) {
  if (goal.examDate === undefined) return null
  const days = daysBetween(today(), goal.examDate)
  return <span className="dshs-small dshs-muted">{days >= 0 ? `距考试 ${days} 天` : `考试已过 ${-days} 天`}</span>
}

function BookCard({ material: m, subjectName, onOpen }: { material: Material; subjectName?: string; onOpen: () => void }) {
  const p = progressOf(m)
  const pace = paceOf(m)
  const pct = p.total === 0 ? 0 : Math.round((p.done / p.total) * 100)
  let sub = '未设目标日期'
  if (m.chapters.length === 0) sub = m.kind === 'book' ? '还没有目录' : '没有视频'
  else if (p.total > 0 && p.done === p.total) sub = '已学完'
  else if (pace?.overdue) sub = '已过目标日期'
  else if (pace?.perDay !== undefined) sub = `每天约 ${pace.perDay} 节`
  return (
    <button type="button" className="dshs-book" onClick={onOpen} title={m.title}>
      <div className="dshs-cover" style={{ background: coverColor(m.title) }}>
        <div className="dshs-cover-kind">{m.kind === 'book' ? '教材' : '视频课'}{subjectName ? ` · ${subjectName}` : ''}</div>
        <div className="dshs-cover-title">{m.title}</div>
        <div className="dshs-cover-bar"><i style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="dshs-book-meta">{p.done} / {p.total} {m.kind === 'video' ? '集' : '节'}</div>
      <div className="dshs-book-sub">{sub}</div>
    </button>
  )
}

function GoalForm({ goal, onDone }: { goal?: Goal; onDone: (newId?: string) => void }) {
  const [date, setDate] = useState(goal?.examDate ?? '')
  return (
    <TextForm
      initial={goal?.name}
      placeholder="学习目标，如：2027 法考"
      submitLabel={goal ? '保存' : '新建'}
      onSubmit={async (name) => {
        if (goal) await op('updateGoal', { id: goal.id, name, examDate: date || null })
        else onDone((await op<{ id: string }>('addGoal', { name, examDate: date || undefined })).id)
      }}
      onCancel={() => onDone()}
      extra={(
        <>
          <div className="dshs-row">
            <span className="dshs-label">考试日期</span>
            <input className="dshs-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <span className="dshs-small dshs-muted">可不填</span>
          </div>
          {goal && <div className="dshs-row"><ConfirmButton label="删除这个学习目标（含全部科目、资料和错题）" onConfirm={() => { void op('deleteGoal', { id: goal.id }); onDone() }} /></div>}
        </>
      )}
    />
  )
}

function Welcome() {
  const [date, setDate] = useState('')
  return (
    <div className="dshs-empty" style={{ textAlign: 'left' }}>
      <p className="dshs-title">欢迎使用学习书架 📚</p>
      <p>按「学习目标 › 科目 › 资料」整理你的教材和视频课，记录进度和错题。</p>
      <p>先建一个学习目标，比如「2027 法考」「考研数学」「学 AI」。</p>
      <TextForm
        placeholder="学习目标名称"
        submitLabel="开始"
        onSubmit={name => op('addGoal', { name, examDate: date || undefined })}
        onCancel={() => undefined}
        extra={(
          <div className="dshs-row">
            <span className="dshs-label">考试日期</span>
            <input className="dshs-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <span className="dshs-small dshs-muted">可不填</span>
          </div>
        )}
      />
    </div>
  )
}
