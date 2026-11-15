/**
 * EPUB 阅读界面：盖在当前面板上（全屏宫殿里盖住宫殿，右侧栏里盖住右侧栏），不遮 Harness 自己的界面。翻页（← → 或两侧按钮）、按目录跳转、记住位置；
 * 选中一段文字可以记成摘录卡片，记到当前这一节下，书里会留下高亮。
 */
import { useEffect, useRef, useState } from 'react'
import { PanelOverlay } from '../host.tsx'
import type { Card, Item, Section } from '../../shared/palace.ts'
import { apiUrl } from '../api.ts'
import { palaceOp } from '../palace/data.ts'
import { ShareEditor } from '../share/ShareEditor.tsx'
import { mountEpub, sameFile, type EpubHandle } from './epub.ts'

const FONT_KEY = 'dsh-shelf:epub-font-size'

/** 当前目录项（href 带锚点）对应的节；章级目录项（目录里不是节）落到同一文件的第一节。 */
function sectionOf(item: Item, anchor: string | undefined): Section | undefined {
  if (anchor === undefined) return undefined
  const flat = item.chapters.flatMap(c => c.sections)
  return flat.find(x => x.loc === anchor) ?? flat.find(x => x.loc !== undefined && sameFile(x.loc, anchor))
}

export function EpubReader({ item, title, subtitle, onClose }: { item: Item; title: string; subtitle?: string; onClose: () => void }) {
  // 浮层第一次渲染时容器还不在，用 state 记住挂载点，出现后再打开书
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const handle = useRef<EpubHandle>()
  const latest = useRef(item)
  latest.current = item
  const [error, setError] = useState<string>()
  const [ready, setReady] = useState(false)
  const [percent, setPercent] = useState(item.position?.percent ?? 0)
  const [currentId, setCurrentId] = useState<string>()
  const [selection, setSelection] = useState<{ quote: string; loc: string }>()
  const [picked, setPicked] = useState<string>() // 点中的高亮（摘录卡片的 loc）
  const [sharing, setSharing] = useState<Card>()
  const lastIndex = useRef<number>()
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
    const el = stage
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
        onPosition: (pos) => {
          const it = latest.current
          if (pos.percent !== undefined) setPercent(pos.percent)
          const section = sectionOf(it, pos.anchor)
          setCurrentId(section?.id)
          // 往后翻一页、正好从一节翻进下一节：上一节读完了，打勾（跳转、往前翻、刚打开都不算）
          const flat = it.chapters.flatMap(c => c.sections)
          const index = section === undefined ? -1 : flat.findIndex(x => x.id === section.id)
          const prev = lastIndex.current
          lastIndex.current = index >= 0 ? index : undefined
          if (pos.byTurn && prev !== undefined && index === prev + 1 && !flat[prev].done) {
            void palaceOp('setSectionDone', { id: it.id, sectionId: flat[prev].id, done: true }).catch(() => undefined)
          }
          // 精确进度还没算好时沿用上次的，不存粗略估算；翻页很快，停 1 秒再存
          const percent = pos.percent ?? pendingPos.current?.percent ?? it.position?.percent ?? 0
          pendingPos.current = { loc: pos.loc, percent }
          clearTimeout(posTimer.current)
          posTimer.current = setTimeout(savePosition, 1000)
        },
        onSelect: (sel) => { setPicked(undefined); setSelection(sel) },
        onHighlight: (cfi) => { setSelection(undefined); setPicked(cfi) },
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
  }, [item.id, stage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 只关最上面一层：分享编辑器自己处理；有选中 / 高亮操作条时先收起它
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sharing) return
      if (selection || picked) { setSelection(undefined); setPicked(undefined); return }
      onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose, sharing, selection, picked])

  const sections = item.chapters.flatMap(c => c.sections.map(s => ({ s, label: c.title === s.title ? s.title : `${c.title} › ${s.title}` })))
  const current: Section | undefined = sections.find(x => x.s.id === currentId)?.s

  const pickedCard = picked === undefined ? undefined : item.cards.find(k => k.loc === picked)
  const cancelExcerpt = async () => {
    if (!pickedCard || picked === undefined) return
    try {
      await palaceOp('deleteCard', { id: item.id, cardId: pickedCard.id })
      handle.current?.unhighlight(picked)
      setPicked(undefined)
    } catch (e) {
      setStatus(`没删掉：${(e as Error).message}`)
    }
  }

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

  return (
    <PanelOverlay>
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
        <div className="rd-stage" ref={setStage}>
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
      {pickedCard && (
        <div className="rd-select">
          <span className="rd-quote">{pickedCard.quote}</span>
          <button type="button" className="rd-btn" onClick={() => setSharing(pickedCard)}>分享</button>
          <button type="button" className="rd-text rd-danger" onClick={() => void cancelExcerpt()}>取消摘录</button>
          <button type="button" className="rd-text" aria-label="关闭" onClick={() => setPicked(undefined)}>×</button>
        </div>
      )}
      {sharing && <ShareEditor itemId={item.id} card={sharing} title={title} subtitle={subtitle} onClose={() => setSharing(undefined)} />}
    </div>
    </PanelOverlay>
  )
}
