/**
 * EPUB 阅读界面：盖在整个窗口上。翻页（← → 或两侧按钮）、按目录跳转、记住位置；
 * 选中一段文字可以记成摘录卡片，记到当前这一节下，书里会留下高亮。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Item, Section } from '../../shared/palace.ts'
import { apiUrl } from '../api.ts'
import { palaceOp } from '../palace/data.ts'
import { mountEpub, type EpubHandle } from './epub.ts'

const FONT_KEY = 'dsh-shelf:epub-font-size'

/** 目录里的 href 和 epub.js 报告的 href 前缀可能不同（相对路径），只比文件名部分。 */
function sameFile(a: string, b: string): boolean {
  const strip = (h: string) => decodeURIComponent(h.split('#')[0]).replace(/^(\.\.\/|\.\/)+/, '')
  const x = strip(a)
  const y = strip(b)
  return x !== '' && y !== '' && (x === y || x.endsWith('/' + y) || y.endsWith('/' + x))
}

export function EpubReader({ item, title, onClose }: { item: Item; title: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const handle = useRef<EpubHandle>()
  const latest = useRef(item)
  latest.current = item
  const [error, setError] = useState<string>()
  const [ready, setReady] = useState(false)
  const [percent, setPercent] = useState(item.position?.percent ?? 0)
  const [href, setHref] = useState('')
  const [selection, setSelection] = useState<{ quote: string; loc: string }>()
  const [status, setStatus] = useState('')
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem(FONT_KEY)) || 18)
  const pendingPos = useRef<{ loc: string; percent: number }>()
  const posTimer = useRef<ReturnType<typeof setTimeout>>()

  const savePosition = () => {
    clearTimeout(posTimer.current)
    const pos = pendingPos.current
    if (pos === undefined) return
    pendingPos.current = undefined
    void palaceOp('setPosition', { id: latest.current.id, ...pos }).catch(() => undefined)
  }

  useEffect(() => {
    const el = stage.current
    if (!el) return
    let destroyed = false
    void (async () => {
      const response = await fetch(apiUrl('file', { id: item.id }))
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `EPUB 读取失败（HTTP ${response.status}）`)
      }
      const data = await response.arrayBuffer()
      if (destroyed) return
      const h = await mountEpub(el, {
        data,
        initialLoc: item.position?.loc,
        highlights: item.cards.filter(k => k.type === 'excerpt' && k.loc?.startsWith('epubcfi(')).map(k => k.loc as string),
        fontSize,
        onPosition: (loc, p, file) => {
          setPercent(p)
          setHref(file)
          // 翻页很快，停 1 秒再存
          pendingPos.current = { loc, percent: p }
          clearTimeout(posTimer.current)
          posTimer.current = setTimeout(savePosition, 1000)
        },
        onSelect: sel => setSelection(sel),
        onToc: (outline) => {
          // 第一次打开：用书自带的目录建「进度」里的章节
          if (latest.current.chapters.length === 0 && outline.length > 0) {
            void palaceOp('setOutline', { id: item.id, chapters: outline, source: 'toc' }).catch(() => undefined)
          }
        },
      })
      if (destroyed) { h.destroy(); return }
      handle.current = h
      setReady(true)
    })().catch((e: Error) => { if (!destroyed) setError(e.message) })
    return () => {
      destroyed = true
      savePosition()
      handle.current?.destroy()
      handle.current = undefined
    }
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const sections = item.chapters.flatMap(c => c.sections.map(s => ({ s, label: c.title === s.title ? s.title : `${c.title} › ${s.title}` })))
  const current: Section | undefined = href === '' ? undefined : [...sections].reverse().find(x => x.s.loc && sameFile(x.s.loc, href))?.s

  const changeFont = (delta: number) => {
    const next = Math.max(14, Math.min(28, fontSize + delta))
    setFontSize(next)
    localStorage.setItem(FONT_KEY, String(next))
    handle.current?.setFontSize(next)
  }

  const saveExcerpt = async () => {
    if (!selection) return
    try {
      await palaceOp('addCard', { id: item.id, type: 'excerpt', quote: selection.quote, loc: selection.loc, sectionId: current?.id })
      handle.current?.highlight(selection.loc)
      handle.current?.clearSelection()
      setSelection(undefined)
      setStatus('已记为摘录')
      setTimeout(() => setStatus(''), 2000)
    } catch (e) {
      setStatus(`没记上：${(e as Error).message}`)
    }
  }

  return createPortal(
    <div className="rd-root">
      <header className="rd-head">
        <button type="button" className="rd-text" onClick={onClose}>← 返回</button>
        <span className="rd-title">{title}</span>
        {sections.length > 0 && (
          <select value={current?.id ?? ''} onChange={(e) => {
            const loc = sections.find(x => x.s.id === e.target.value)?.s.loc
            if (loc) handle.current?.goTo(loc)
          }}>
            {current === undefined && <option value="">目录</option>}
            {sections.map(x => <option key={x.s.id} value={x.s.id}>{x.label}</option>)}
          </select>
        )}
        <span className="rd-spacer" />
        <span className="rd-muted">{status}</span>
        <button type="button" className="rd-text" title="字小一点" onClick={() => changeFont(-1)}>A−</button>
        <button type="button" className="rd-text" title="字大一点" onClick={() => changeFont(1)}>A+</button>
        <span className="rd-muted">{Math.round(percent * 100)}%</span>
      </header>
      <div className="rd-body">
        <button type="button" className="rd-turn" aria-label="上一页" onClick={() => handle.current?.prev()}>‹</button>
        <div className="rd-stage" ref={stage}>
          {error ? <p className="rd-error">{error}</p> : !ready && <p className="rd-muted rd-loading">正在打开…</p>}
        </div>
        <button type="button" className="rd-turn" aria-label="下一页" onClick={() => handle.current?.next()}>›</button>
      </div>
      {selection && (
        <div className="rd-select">
          <span className="rd-quote">{selection.quote}</span>
          <button type="button" className="rd-btn" onClick={() => void saveExcerpt()}>记为摘录</button>
          <button type="button" className="rd-text" onClick={() => { handle.current?.clearSelection(); setSelection(undefined) }}>取消</button>
        </div>
      )}
    </div>,
    document.body,
  )
}
