/**
 * 勾选目录页：缩略图网格，点选 / Shift 连选，确认后把页码（扫描版还附上页面图片）发到对话，让 AI 生成目录。
 * 只把选中的几页交给 AI，省 token 也更快。
 */
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Item } from '../../shared/palace.ts'
import { pageTexts } from '../api.ts'
import { canChat, sendText, sendWithImages } from '../chat.ts'
import { loadPdf, pagesToFiles, releasePdf, renderPage } from '../pdf.ts'
import { Overlay, useAction } from './common.tsx'

/** 扫描页要作为图片发送，一次别太多。 */
const MAX_IMAGE_PAGES = 12
const RULES = '要求：只要两级（章 › 节），更细的小标题忽略；标题照原书写，去掉页码和省略号；'
  + '用 shelf_set_outline 写入，写完用一句话告诉我共几章几节。'

export function PagePicker({ item, title, sessionId, onDone }: {
  item: Item
  title: string
  sessionId?: string
  /** 发送成功或取消都回到笔记本。 */
  onDone: () => void
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy>()
  const [loadError, setLoadError] = useState<string>()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number>()
  const [zoom, setZoom] = useState<number>()
  const [status, setStatus] = useState<string>()
  const { busy, error, setError, run } = useAction()

  useEffect(() => {
    let alive = true
    loadPdf(item.id).then(d => alive && setDoc(d), (e: Error) => alive && setLoadError(e.message))
    return () => { alive = false; releasePdf(item.id) }
  }, [item.id])

  const toggle = (page: number, shift: boolean) => {
    const next = new Set(selected)
    if (shift && anchor !== undefined) {
      const [a, b] = anchor < page ? [anchor, page] : [page, anchor]
      for (let i = a; i <= b; i++) next.add(i)
    } else if (next.has(page)) next.delete(page)
    else next.add(page)
    setAnchor(page)
    setSelected(next)
  }

  const pages = [...selected].sort((a, b) => a - b)
  const chatOk = canChat(sessionId)

  const confirm = () => run(async () => {
    if (!chatOk || sessionId === undefined) throw new Error('生成目录需要 AI：请在对话旁边打开笔记本（对话标题栏右侧的按钮）再操作。')
    setStatus('检查页面文字…')
    const { scanned } = await pageTexts(item.id, pages)
    const head = `请帮我生成《${title}》的目录（item_id: ${item.id}）。目录在 PDF 第 ${pages.join('、')} 页。`
    if (scanned.length === 0) {
      await sendText(sessionId, `${head}请用 shelf_read 读取这些页的文字。${RULES}`)
    } else {
      if (scanned.length > MAX_IMAGE_PAGES) throw new Error(`这几页是扫描版，需要作为图片发给 AI，一次最多 ${MAX_IMAGE_PAGES} 页。请分两次生成，或只选最关键的目录页。`)
      setStatus(`正在把 ${scanned.length} 页转成图片…`)
      const files = await pagesToFiles(item.id, scanned, title)
      const textPages = pages.filter(p => !scanned.includes(p))
      const text = `${head}其中第 ${scanned.join('、')} 页是扫描件，页面图片附在这条消息里，请直接看图识别`
        + (textPages.length > 0 ? `；第 ${textPages.join('、')} 页用 shelf_read 读取文字` : '')
        + `。${RULES}`
      if (!sendWithImages(sessionId, text, files)) {
        await sendText(sessionId, `${head}这些页是扫描件，书架没能把页面图片附到对话里。请提示我把这几页截图发给你，再生成目录。${RULES}`)
      }
    }
    onDone()
  }).finally(() => setStatus(undefined))

  return (
    <div>
      <div className="nb-picker-bar">
        <div className="nb-row">
          <button type="button" className="nb-link" onClick={onDone}>← 返回</button>
          <span className="nb-spacer" />
          <button type="button" className="nb-btn nb-primary" disabled={busy || pages.length === 0} onClick={() => void confirm()}>
            {busy ? (status ?? '发送中…') : `确认，生成目录（${pages.length} 页）`}
          </button>
        </div>
        <div className="nb-small nb-muted" style={{ marginTop: 6 }}>
          勾选《{title}》的目录页。按住 Shift 点击可以连选；鼠标移到页面上点「放大」。
          {pages.length > 0 && <> 已选：第 {pages.join('、')} 页 · <button type="button" className="nb-link" onClick={() => { setSelected(new Set()); setError(undefined) }}>清空</button></>}
        </div>
        {!chatOk && <div className="nb-error" style={{ marginTop: 6 }}>当前不在对话里：生成目录需要 AI，请在对话旁边打开笔记本再操作。</div>}
        {error && <div className="nb-error" style={{ marginTop: 6 }}>{error}</div>}
      </div>

      {loadError && <div className="nb-error" style={{ marginTop: 12 }}>{loadError}</div>}
      {!doc && !loadError && <div className="nb-empty">正在打开 PDF…</div>}
      {doc && (
        <div className="nb-pages">
          {Array.from({ length: doc.numPages }, (_, i) => i + 1).map(n => (
            <Thumb key={n} doc={doc} page={n} on={selected.has(n)} onToggle={shift => toggle(n, shift)} onZoom={() => setZoom(n)} />
          ))}
        </div>
      )}
      {zoom !== undefined && doc && <Overlay onClose={() => setZoom(undefined)}><BigPage doc={doc} page={zoom} /></Overlay>}
    </div>
  )
}

function Thumb({ doc, page, on, onToggle, onZoom }: {
  doc: PDFDocumentProxy; page: number; on: boolean; onToggle: (shift: boolean) => void; onZoom: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  // 滚动到附近才渲染，几百页的书也不卡
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect() } }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || canvas.current === null) return
    const ac = new AbortController()
    renderPage(doc, page, canvas.current, 120, ac.signal).catch(() => undefined)
    return () => ac.abort()
  }, [visible, doc, page])

  return (
    <div ref={ref} className={`nb-page ${on ? 'nb-page-on' : ''}`} role="button" tabIndex={0}
      onClick={e => onToggle(e.shiftKey)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(e.shiftKey) } }}>
      <div className="nb-page-frame"><canvas ref={canvas} /></div>
      {on && <span className="nb-page-check">✓</span>}
      <button type="button" className="nb-page-zoom" title="放大" onClick={(e) => { e.stopPropagation(); onZoom() }}>放大</button>
      <div className="nb-page-num">{page}</div>
    </div>
  )
}

function BigPage({ doc, page }: { doc: PDFDocumentProxy; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current === null) return
    const ac = new AbortController()
    const width = Math.min(900, window.innerWidth - 48)
    renderPage(doc, page, canvas.current, width, ac.signal).catch(() => undefined)
    return () => ac.abort()
  }, [doc, page])
  return <canvas ref={canvas} />
}
