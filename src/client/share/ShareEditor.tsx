/**
 * 分享卡片编辑器：把一张卡片排成 1080×1440 的图，导出 PNG。
 * 草稿存在 card.share 里（停手 0.6 秒自动保存），下次打开接着改。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Card } from '../../shared/palace.ts'
import { palaceOp } from '../palace/data.ts'
import { draw, loadFont, measurer } from './draw.ts'
import {
  FONTS, H, PAPERS, W, defaultSource, draftFor, layout, mergeDraft, normalizeRanges, sourceOf,
  type FontId, type Range, type ShareDraft, type ShareTexts, type TextKey,
} from './model.ts'

export function ShareEditor({ itemId, card, title, subtitle, onClose }: {
  itemId: string
  card: Card
  title: string
  subtitle?: string
  onClose: () => void
}) {
  const texts: ShareTexts = { quote: card.quote ?? '', note: card.note ?? '' }
  const [draft, setDraft] = useState<ShareDraft>(() => draftFor(card.share, texts))
  const [status, setStatus] = useState('')
  const [problem, setProblem] = useState<string>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const pending = useRef<ShareDraft>()
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const fallbackSource = defaultSource(title, subtitle)

  const update = (patch: Partial<ShareDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    pending.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 600)
  }

  const flush = async (): Promise<boolean> => {
    clearTimeout(timer.current)
    const next = pending.current
    if (next === undefined) return true
    pending.current = undefined
    try {
      await palaceOp('updateCard', { id: itemId, cardId: card.id, share: mergeDraft(card.share, next) })
      setStatus('草稿已保存')
      return true
    } catch (e) {
      pending.current ??= next
      setStatus(`草稿保存失败：${(e as Error).message}`)
      return false
    }
  }

  // 编辑器被意外卸载（比如卡片被 AI 删了）时也把草稿存下
  useEffect(() => () => { void flush() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { void flush().then(ok => { if (ok) onClose() }) }

  // 排版 + 画图
  useEffect(() => {
    let stale = false
    void loadFont(draft).then(() => {
      const ctx = canvas.current?.getContext('2d')
      if (stale || !ctx) return
      const result = layout(draft, texts, sourceOf(draft, fallbackSource), measurer(ctx, draft))
      draw(ctx, draft, result)
      setProblem(result.empty ? '请选择要分享的文字。' : result.overflow ? '文字放不下一张纸，请少选一些，或者把字号调小。' : undefined)
    })
    return () => { stale = true }
  }, [draft, card.quote, card.note, fallbackSource]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const exportPng = async () => {
    void flush()
    const el = canvas.current
    const blob = el ? await new Promise<Blob | null>(resolve => el.toBlob(resolve, 'image/png')) : null
    if (!blob) { setStatus('图片导出失败，请重试'); return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || '卡片'}-分享.png`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus('已导出 1080 × 1440 PNG')
  }

  const setRanges = (key: TextKey, ranges: Range[]) => update({ ranges: { ...draft.ranges, [key]: ranges } })

  return createPortal(
    <div className="sh-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) close() }}>
      <div className="sh-dialog" role="dialog" aria-label="分享卡片">
        <header className="sh-head">
          <div>
            <div className="sh-eyebrow">A THOUGHT TO KEEP</div>
            <h2>分享卡片</h2>
          </div>
          <span className="sh-status">{status}</span>
          <button type="button" className="sh-btn sh-primary" disabled={problem !== undefined} onClick={() => void exportPng()}>导出 PNG</button>
          <button type="button" className="sh-close" aria-label="关闭" onClick={close}>×</button>
        </header>
        <div className="sh-body">
          <div className="sh-stage">
            <canvas ref={canvas} width={W} height={H} className="sh-paper" />
            <div className={problem ? 'sh-feedback sh-error' : 'sh-feedback'}>{problem ?? '3 : 4 · 1080 × 1440 PNG'}</div>
          </div>
          <div className="sh-panel">
            <Field label="纸色">
              <div className="sh-swatches">
                {PAPERS.map(c => (
                  <button key={c} type="button" aria-label={c} aria-pressed={draft.color === c} style={{ background: c }} onClick={() => update({ color: c })} />
                ))}
                <input type="color" value={draft.color} aria-label="自定义纸色" onChange={e => update({ color: e.target.value })} />
              </div>
            </Field>
            <Field label="字体">
              <select value={draft.font} onChange={e => update({ font: e.target.value as FontId })}>
                {Object.entries(FONTS).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="对齐">
              <div className="sh-seg">
                {(['left', 'center'] as const).map(a => (
                  <button key={a} type="button" aria-pressed={draft.align === a} onClick={() => update({ align: a })}>{a === 'left' ? '居左' : '居中'}</button>
                ))}
              </div>
            </Field>

            {texts.quote && (
              <TextPart label="原文" text={texts.quote} shown={draft.showQuote} ranges={draft.ranges.quote}
                size={draft.size} onShown={v => update({ showQuote: v })} onRanges={r => setRanges('quote', r)} onSize={v => update({ size: v })} />
            )}
            {texts.note && (
              <TextPart label="想法" text={texts.note} shown={draft.showNote} ranges={draft.ranges.note}
                size={draft.noteSize} onShown={v => update({ showNote: v })} onRanges={r => setRanges('note', r)} onSize={v => update({ noteSize: v })} />
            )}

            <section className="sh-part">
              <label className="sh-check"><input type="checkbox" checked={draft.showSource} onChange={e => update({ showSource: e.target.checked })} />出处</label>
              {draft.showSource && (
                <>
                  <input className="sh-input" value={sourceOf(draft, fallbackSource)} onChange={e => update({ source: e.target.value })} />
                  {draft.source !== undefined && draft.source !== fallbackSource && (
                    <button type="button" className="sh-link" onClick={() => update({ source: undefined })}>恢复书名和作者</button>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sh-field"><span>{label}</span>{children}</div>
}

/** 一段文字：显示开关、拖选要放上图的部分（点高亮取消）、字号。 */
function TextPart({ label, text, shown, ranges, size, onShown, onRanges, onSize }: {
  label: string
  text: string
  shown: boolean
  ranges: Range[]
  size: number
  onShown: (v: boolean) => void
  onRanges: (r: Range[]) => void
  onSize: (v: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const justPicked = useRef(0)
  const list = normalizeRanges(ranges, text.length)
  const all = list.length === 1 && list[0][0] === 0 && list[0][1] === text.length
  const count = list.reduce((n, [a, b]) => n + b - a, 0)

  const pick = () => {
    const sel = window.getSelection()
    const node = box.current
    if (!sel || sel.isCollapsed || !sel.rangeCount || !node) return
    const range = sel.getRangeAt(0)
    if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) return
    // 用前缀长度换算成 UTF-16 偏移
    const prefix = range.cloneRange()
    prefix.selectNodeContents(node)
    prefix.setEnd(range.startContainer, range.startOffset)
    const start = prefix.toString().length
    prefix.setEnd(range.endContainer, range.endOffset)
    const end = prefix.toString().length
    if (end <= start || !text.slice(start, end).trim()) return
    justPicked.current = Date.now()
    // 第一次拖选（还是整段全选时）替换掉全选，之后的拖选是追加
    onRanges(normalizeRanges([...(all ? [] : list), [start, end]], text.length))
    sel.removeAllRanges()
  }

  const pieces: ReactNode[] = []
  let at = 0
  for (const [a, b] of list) {
    if (a > at) pieces.push(text.slice(at, a))
    pieces.push(
      <mark key={a} onClick={() => { if (Date.now() - justPicked.current > 250) onRanges(list.filter(r => r[0] !== a)) }}>{text.slice(a, b)}</mark>,
    )
    at = b
  }
  if (at < text.length) pieces.push(text.slice(at))

  return (
    <section className="sh-part">
      <label className="sh-check"><input type="checkbox" checked={shown} onChange={e => onShown(e.target.checked)} />{label}</label>
      {shown && (
        <>
          <div ref={box} className="sh-pick" onPointerUp={pick}>{pieces}</div>
          <div className="sh-row">
            <span>{count} 字已选</span>
            <span className="sh-spacer" />
            {!all && <button type="button" className="sh-link" onClick={() => onRanges([[0, text.length]])}>全选</button>}
            {list.length > 0 && <button type="button" className="sh-link" onClick={() => onRanges([])}>清空</button>}
          </div>
          <label className="sh-range">
            <span>字号 {size}</span>
            <input type="range" min={label === '想法' ? 18 : 28} max={76} value={size} onChange={e => onSize(Number(e.target.value))} />
          </label>
        </>
      )}
    </section>
  )
}
