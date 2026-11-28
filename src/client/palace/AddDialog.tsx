/**
 * 「＋」：放进宫殿（#123）。
 * - 写几句话（书名、链接、一个念头……）→ 打开宫殿对话替用户发出去，由 AI 判断建什么格子、查目录。
 * - 选本地 PDF / EPUB → 不走 AI，直接建格子（书签、目录由代码读）。
 * - 新建分组 → 起个名字，直接建。
 * 分组展开时，放进这个分组。
 */
import { useEffect, useRef, useState } from 'react'
import { pickBook } from '../api.ts'
import { sessionsService, useChatSlots } from '../chat/host.tsx'
import { palaceOp } from './data.ts'

export function AddDialog({ parentId, parentTitle, onAsk, onClose }: {
  parentId?: string
  parentTitle?: string
  /** 把写的内容交给 AI（打开宫殿对话并发送） */
  onAsk: (text: string) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'ask' | 'group'>('ask')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const chat = useChatSlots() !== undefined && sessionsService() !== undefined

  // 取消 / 关闭时中止还在读取的请求，Host 收到后不会再建格子
  const abort = useRef<AbortController>()
  useEffect(() => () => abort.current?.abort(), [])

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    abort.current = new AbortController()
    try {
      await op()
      onClose()
    } catch (e) {
      if (abort.current?.signal.aborted) return
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pick = async () => {
    const path = await pickBook().catch(() => undefined)
    if (path === undefined) { setError('这台电脑不能弹出选择框'); return }
    if (path) await run(() => palaceOp('addBook', { file: path, parentId }, abort.current?.signal))
  }

  const submit = () => {
    const t = text.trim()
    if (t === '' || busy) return
    if (mode === 'group') { void run(() => palaceOp('addCell', { kind: 'group', title: t })); return }
    if (!chat) { setError('未连接 AI'); return }
    onAsk(parentTitle !== undefined ? `放进宫殿（分组「${parentTitle}」）：${t}` : `放进宫殿：${t}`)
    onClose()
  }

  return (
    <div className="mp-dialog-backdrop" onPointerDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}>
      <form className="mp-dialog" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="mp-dialog-head">
          <h2>{mode === 'group' ? '新建分组' : '放进宫殿'}</h2>
          <button type="button" className="mp-text-btn" onClick={onClose}>取消</button>
        </div>
        {mode === 'ask'
          ? (
            <>
              <textarea className="mp-add-text" value={text} autoFocus rows={3} placeholder={'一本书、一部剧、一个链接、一个念头……\nAI 会帮你放好，需要的话查好目录。'}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
              <div className="mp-add-alt">
                <button type="button" className="mp-text-btn" disabled={busy} onClick={() => void pick()}>{busy ? '读取中…' : '选本地 PDF / EPUB…'}</button>
                {parentId === undefined && <button type="button" className="mp-text-btn" onClick={() => { setMode('group'); setText('') }}>新建分组</button>}
              </div>
            </>
          )
          : <input value={text} autoFocus placeholder="分组名" onChange={e => setText(e.target.value)} />}

        {error && <p className="mp-error">{error}</p>}
        <div className="mp-dialog-actions">
          <button type="submit" className="mp-text-btn mp-primary" disabled={text.trim() === '' || busy}>{mode === 'group' ? '建好' : '交给 AI'}</button>
        </div>
      </form>
    </div>
  )
}
