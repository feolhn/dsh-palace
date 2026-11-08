/** 添加资料：PDF 教材 或 B 站视频课。 */
import { useState } from 'react'
import type { Library, MaterialKind } from '../../shared/model.ts'
import { op, pickPdf } from '../api.ts'
import { useAction } from './common.tsx'

export function AddMaterial({ library, subjectId: initialSubject, onDone, onCancel }: {
  library: Library
  subjectId?: string
  onDone: (materialId: string) => void
  onCancel: () => void
}) {
  const [kind, setKind] = useState<MaterialKind>('book')
  const [subjectId, setSubjectId] = useState(initialSubject ?? library.subjects[0]?.id ?? '')
  const [file, setFile] = useState('')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [canPick, setCanPick] = useState(true)
  const { busy, error, setError, run } = useAction()

  const choose = () => run(async () => {
    const path = await pickPdf()
    if (path === undefined) setCanPick(false) // 非 macOS：只能粘贴路径
    else if (path !== null) setFile(path)
  })

  const submit = () => run(async () => {
    if (subjectId === '') throw new Error('请先选择科目')
    const args = { subjectId, title: title || undefined, targetDate: targetDate || undefined }
    const m = kind === 'book'
      ? await op<{ id: string }>('addBook', { ...args, file })
      : await op<{ id: string }>('addVideo', { ...args, url })
    onDone(m.id)
  })

  const subjects = library.subjects
  const goalName = (goalId: string) => library.goals.find(g => g.id === goalId)?.name ?? ''

  return (
    <div>
      <button type="button" className="dshs-link dshs-back" onClick={onCancel}>← 返回书架</button>
      <h2 className="dshs-title">添加资料</h2>
      <div className="dshs-chips">
        <button type="button" className={`dshs-chip ${kind === 'book' ? 'dshs-chip-on' : ''}`} onClick={() => { setKind('book'); setError(undefined) }}>PDF 教材</button>
        <button type="button" className={`dshs-chip ${kind === 'video' ? 'dshs-chip-on' : ''}`} onClick={() => { setKind('video'); setError(undefined) }}>B 站视频课</button>
      </div>

      <div className="dshs-form">
        <div className="dshs-row">
          <span className="dshs-label">科目</span>
          <select className="dshs-select dshs-input-grow" value={subjectId} onChange={e => setSubjectId(e.target.value)}>
            {subjects.map(s => <option key={s.id} value={s.id}>{goalName(s.goalId)} · {s.name}</option>)}
          </select>
        </div>

        {kind === 'book'
          ? (
              <>
                <div className="dshs-row">
                  <span className="dshs-label">PDF 文件</span>
                  {canPick && <button type="button" className="dshs-btn" disabled={busy} onClick={() => void choose()}>选择文件…</button>}
                  <input className="dshs-input dshs-input-grow" value={file} placeholder="/Users/你/Documents/刑法.pdf" onChange={e => setFile(e.target.value)} />
                </div>
                <div className="dshs-small dshs-muted">
                  只记录文件位置，不会复制文件；你在阅读器里做的批注都留在原文件。
                  {!canPick && ' 获取路径：在文件管理器里选中文件，复制它的完整路径粘贴到这里。'}
                </div>
              </>
            )
          : (
              <>
                <div className="dshs-row">
                  <span className="dshs-label">视频链接</span>
                  <input className="dshs-input dshs-input-grow" value={url} placeholder="https://www.bilibili.com/video/BV…" onChange={e => setUrl(e.target.value)} />
                </div>
                <div className="dshs-small dshs-muted">支持多分 P 视频和合集，会自动读出每一集的标题。</div>
              </>
            )}

        <div className="dshs-row">
          <span className="dshs-label">名称</span>
          <input className="dshs-input dshs-input-grow" value={title} placeholder={kind === 'book' ? '默认用文件名' : '默认用视频标题'} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="dshs-row">
          <span className="dshs-label">目标日期</span>
          <input className="dshs-input" type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
          <span className="dshs-small dshs-muted">打算哪天学完，可以以后再设</span>
        </div>
        <div className="dshs-row">
          <button type="button" className="dshs-btn dshs-btn-primary" disabled={busy || (kind === 'book' ? file === '' : url === '')} onClick={() => void submit()}>
            {busy ? (kind === 'book' ? '正在读取 PDF…' : '正在读取视频列表…') : '添加'}
          </button>
          <button type="button" className="dshs-btn dshs-btn-ghost" onClick={onCancel}>取消</button>
        </div>
        {error && <div className="dshs-error">{error}</div>}
      </div>
    </div>
  )
}
