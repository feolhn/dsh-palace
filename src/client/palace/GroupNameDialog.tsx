/**
 * 拖成新分组后弹出的命名框（#40，移植原型 #group-name-dialog）：中文名可选（显示在标题上方的小字），英文名必填（主标题）。
 * 关掉不填就保留默认名「新分组」，以后在分组顶部还能改。
 */
import { useState } from 'react'
import type { Cell } from '../../shared/palace.ts'
import { palaceOp } from './data.ts'

export function GroupNameDialog({ group, onClose }: { group: Cell; onClose: () => void }) {
  const [zh, setZh] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (title.trim() === '' || busy) return
    setBusy(true)
    try {
      await palaceOp('updateCell', { id: group.id, title: title.trim(), subtitle: zh.trim() === '' ? null : zh.trim() })
      onClose()
    } catch {
      setError('保存失败，请重试')
      setBusy(false)
    }
  }

  return (
    <div className="mp-dialog-backdrop mp-glass-backdrop" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <form className="mp-dialog mp-glass" onSubmit={e => { e.preventDefault(); void save() }}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
        <div className="mp-glass-head">
          <h2>为新分组命名</h2>
          <button type="button" aria-label="取消" onClick={onClose}>×</button>
        </div>
        <label htmlFor="mp-group-zh">中文名 <small>可选</small></label>
        <input id="mp-group-zh" maxLength={80} autoComplete="off" placeholder="输入中文名称" value={zh} onChange={e => setZh(e.target.value)} />
        <label htmlFor="mp-group-en">英文名</label>
        <input id="mp-group-en" required maxLength={160} autoComplete="off" placeholder="输入英文名称" autoFocus value={title} onChange={e => setTitle(e.target.value)} />
        {error && <p className="mp-error" role="alert">{error}</p>}
        <div className="mp-glass-actions"><button type="submit" disabled={title.trim() === '' || busy}>保存 ↗</button></div>
      </form>
    </div>
  )
}
