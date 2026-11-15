/** 添加格子：书（PDF / 视频课）、笔记、分组。分组展开时，书和笔记放进这个分组。 */
import { useEffect, useRef, useState } from 'react'
import { pickPdf } from '../api.ts'
import { palaceOp } from './data.ts'

type Kind = 'book' | 'note' | 'group'
const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'book', label: '书', hint: 'PDF 或视频课，有目录和进度' },
  { kind: 'note', label: '笔记', hint: '没有原文：日记、心情、追剧……' },
  { kind: 'group', label: '分组', hint: '像文件夹，把几格收在一起' },
]

export function AddDialog({ parentId, onClose }: { parentId?: string; onClose: () => void }) {
  const kinds = parentId !== undefined ? KINDS.filter(k => k.kind !== 'group') : KINDS
  const [kind, setKind] = useState<Kind>('book')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const pick = async () => {
    const path = await pickPdf().catch(() => undefined)
    if (path) setFile(path)
    else if (path === undefined) setError('这台电脑不能弹出选择框，请把 PDF 的完整路径粘贴进来')
  }

  // 取消 / 关闭时中止还在读取的请求，Host 收到后不会再建格子
  const abort = useRef<AbortController>()
  useEffect(() => () => abort.current?.abort(), [])

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    abort.current = new AbortController()
    try {
      if (kind === 'book') await palaceOp('addBook', { file, url, title, parentId }, abort.current.signal)
      else await palaceOp('addCell', { kind, title, parentId })
      onClose()
    } catch (e) {
      if (abort.current?.signal.aborted) return
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ready = kind === 'book' ? file.trim() !== '' || url.trim() !== '' : title.trim() !== ''
  return (
    <div className="mp-dialog-backdrop" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <form className="mp-dialog" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void submit() }}>
        <div className="mp-dialog-head">
          <h2>放进宫殿</h2>
          <button type="button" className="mp-text-btn" onClick={onClose}>取消</button>
        </div>
        <div className="mp-kinds">
          {kinds.map(k => (
            <button key={k.kind} type="button" className={kind === k.kind ? 'mp-on' : ''} onClick={() => setKind(k.kind)}>
              <span>{k.label}</span><small>{k.hint}</small>
            </button>
          ))}
        </div>

        {kind === 'book' && (
          <>
            <label>PDF 文件</label>
            <div className="mp-row">
              <input value={file} placeholder="/完整路径/书.pdf" onChange={e => { setFile(e.target.value); setUrl('') }} />
              <button type="button" className="mp-text-btn" onClick={() => void pick()}>选择…</button>
            </div>
            <label>或者，B 站视频课链接</label>
            <input value={url} placeholder="https://www.bilibili.com/video/BV…" onChange={e => { setUrl(e.target.value); setFile('') }} />
            <label>名字 <small>不填就用文件名或视频标题</small></label>
          </>
        )}
        {kind !== 'book' && <label>名字</label>}
        <input value={title} autoFocus={kind !== 'book'} onChange={e => setTitle(e.target.value)} />

        {error && <p className="mp-error">{error}</p>}
        <div className="mp-dialog-actions">
          <button type="submit" className="mp-text-btn mp-primary" disabled={!ready || busy}>{busy ? '读取中…' : '放进去'}</button>
        </div>
      </form>
    </div>
  )
}
