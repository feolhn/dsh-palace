/**
 * EPUB 阅读器（epub.js）。脚本不打进插件主包，第一次打开时才从 Host 的 asset 接口加载（WORK §5.4）。
 * 这里只管渲染和事件，存位置、记卡片由外面的界面负责（CONTRACT §4.2）。
 */
import type { OutlineInput } from '../../core/ops.ts'
import { apiUrl } from '../api.ts'
import { wordFromPoint } from './lookup.ts'

/* epub.js 没有类型包，这里只声明用到的部分 */
interface EpubLocation { start: { cfi: string; href: string; index: number; percentage?: number }; end?: { cfi: string } }
/** 翻页后回报给外层的位置。 */
export interface EpubPosition {
  loc: string
  /** 0–1 的精确进度；全书还没切分完时是 undefined（不要存粗略估算）。 */
  percent?: number
  /** 当前所在的目录项 href（带锚点），对应 outline 里的 loc。 */
  anchor?: string
  /** 这次是不是用户往后翻了一页（而不是跳转、往前翻、刚打开）。 */
  byTurn: boolean
}
interface EpubContents { window: Window; document: Document }
interface NavItem { label: string; href: string; subitems?: NavItem[] }
interface Rendition {
  display(target?: string): Promise<void>
  prev(): Promise<void>
  next(): Promise<void>
  on(event: 'relocated', fn: (loc: EpubLocation) => void): void
  on(event: 'selected', fn: (cfi: string, contents: EpubContents) => void): void
  on(event: 'keyup', fn: (e: KeyboardEvent) => void): void
  hooks: { content: { register(fn: (contents: EpubContents) => void): void } }
  annotations: { highlight(cfi: string, data?: object, cb?: () => void, className?: string, styles?: object): void; remove(cfi: string, type: string): void }
  themes: { default(styles: object): void; override(name: string, value: string, priority?: boolean): void }
  getContents(): EpubContents[]
  getRange(cfi: string): Range | undefined
  resize(width?: number, height?: number): void
  spread(mode: 'auto' | 'none', min?: number): void
  currentLocation(): EpubLocation | Promise<EpubLocation> | undefined
  destroy(): void
}
interface EpubBook {
  on(event: 'openFailed', fn: (error: Error) => void): void
  ready: Promise<void>
  loaded: { navigation: Promise<{ toc: NavItem[] }> }
  spine: { length: number }
  locations: { generate(chars: number): Promise<unknown>; percentageFromCfi(cfi: string): number; cfiFromPercentage(p: number): string; length(): number }
  renderTo(el: HTMLElement, opts: object): Rendition
  destroy(): void
}
type EpubFactory = (data: ArrayBuffer) => EpubBook

let loading: Promise<EpubFactory> | undefined

function script(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = `${apiUrl('asset')}?f=reader/${name}`
    el.onload = () => resolve()
    el.onerror = () => { el.remove(); reject(new Error(`阅读器脚本加载失败（${name}）`)) }
    document.head.append(el)
  })
}

/** 按需加载 epub.js（依赖全局 JSZip，所以先加载 jszip）。失败了下次重试。 */
export function loadEpub(): Promise<EpubFactory> {
  const w = window as unknown as { ePub?: EpubFactory; JSZip?: unknown }
  loading ??= (async () => {
    if (w.JSZip === undefined) await script('jszip.min.js')
    if (w.ePub === undefined) await script('epub.min.js')
    if (w.ePub === undefined) throw new Error('阅读器脚本加载失败')
    return w.ePub
  })().catch((e: Error) => { loading = undefined; throw e })
  return loading
}

export interface EpubHandle {
  prev(): void
  next(): void
  goTo(loc: string): void
  highlight(cfi: string): void
  unhighlight(cfi: string): void
  clearSelection(): void
  setFontSize(px: number): void
  /** 跳到全书 0–1 的位置（全书切分完之前不可用，返回 false）。 */
  seek(percent: number): boolean
  destroy(): void
}

/** 目录 href 的文件部分（去掉锚点和开头的 ./ ../）。 */
function fileOf(href: string): string {
  return decodeURIComponent(href.split('#')[0]).replace(/^(\.\.\/|\.\/)+/, '')
}

/** 目录里的 href 和 epub.js 报告的 href 前缀可能不同（相对路径），只比文件名部分。 */
export function sameFile(a: string, b: string): boolean {
  const x = fileOf(a)
  const y = fileOf(b)
  return x !== '' && y !== '' && (x === y || x.endsWith('/' + y) || y.endsWith('/' + x))
}

/** 目录展开成平铺的 href 列表（章和节都在内，按书中顺序）。 */
function flatHrefs(toc: NavItem[]): string[] {
  return toc.flatMap(n => [n.href, ...flatHrefs(n.subitems ?? [])])
}

/** 只取两层：顶层是章，下一层是节（更深的忽略）。 */
function outlineOf(toc: NavItem[]): OutlineInput[] {
  return toc
    .filter(n => n.label.trim() !== '')
    .map(n => ({
      title: n.label.trim(),
      loc: n.href,
      sections: (n.subitems ?? []).filter(s => s.label.trim() !== '').map(s => ({ title: s.label.trim(), loc: s.href })),
    }))
}

/** 双页只在宽面板里用（右侧栏窄，自然是单页）。 */
function spreadFor(el: HTMLElement): 'auto' | 'none' {
  return el.clientWidth >= 760 ? 'auto' : 'none'
}

export async function mountEpub(el: HTMLElement, opts: {
  data: ArrayBuffer
  initialLoc?: string
  highlights: string[]
  fontSize: number
  /** 选中文字和摘录高亮的颜色（跟皮肤走） */
  mark: string
  onPosition(pos: EpubPosition): void
  /** 选中一段文字（划线）；取消选择时不回调。 */
  onSelect(sel: { quote: string; loc: string }): void
  onToc(outline: OutlineInput[]): void
  /** 点了书里的一处高亮。 */
  onHighlight(cfi: string): void
  /** 轻点了一个英文单词（查词，#43）；rect 是单词在外层页面里的位置。lookup() 返回 false 时不查。 */
  onWord?(word: string, rect: { left: number; right: number; top: number; bottom: number }): void
  lookup?(): boolean
  /** 在书里按下了（收起查词弹窗）。 */
  onPress?(): void
}): Promise<EpubHandle> {
  const ePub = await loadEpub()
  const book = ePub(opts.data)
  // 文件损坏时 epub.js 不会让 ready 失败，而是发 openFailed；再加个超时兜底
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('打开超时')), 30_000)
    book.on('openFailed', (e) => { clearTimeout(timer); reject(e) })
    book.ready.then(() => { clearTimeout(timer); resolve() }, (e: Error) => { clearTimeout(timer); reject(e) })
  }).catch((e: Error) => {
    try { book.destroy() } catch { /* 已经坏了 */ }
    throw new Error(`这本 EPUB 打不开，可能文件损坏或没下载完整（${e?.message ?? e}）`)
  })
  const toc = await book.loaded.navigation.then(n => n.toc, () => [] as NavItem[])
  const hrefs = flatHrefs(toc)
  const rendition = book.renderTo(el, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: spreadFor(el),
    allowScriptedContent: false, // 书里的脚本一律不跑
  })
  rendition.themes.default({ body: { 'line-height': '1.8' }, '::selection': { background: opts.mark } })
  rendition.themes.override('font-size', `${opts.fontSize}px`, true)

  /** 同一个文件里可能有好几个目录锚点：取这一页结尾之前出现的最后一个（标题出现在这一页上，就算进了那一节）。 */
  function anchorOf(loc: EpubLocation): string | undefined {
    const same = hrefs.filter(h => sameFile(h, loc.start.href))
    if (same.length <= 1) return same[0]
    let range: Range | undefined
    try { range = rendition.getRange(loc.end?.cfi ?? loc.start.cfi) } catch { range = undefined }
    if (!range) return same[0]
    const start = range.startContainer // 这一页的结尾
    const doc = start.ownerDocument
    let found = same[0]
    for (const h of same) {
      const id = h.split('#')[1]
      if (!id) { found = h; continue } // 没有锚点 = 文件开头
      const target = doc?.getElementById(decodeURIComponent(id))
      if (!target) continue
      const pos = target.compareDocumentPosition(start)
      if (target === start || pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) found = h
    }
    return found
  }

  let locationsReady = false
  let turning = false // 最近一次是不是 next()
  const report = (loc: EpubLocation, byTurn: boolean) => {
    const percent = locationsReady ? Math.max(0, Math.min(1, book.locations.percentageFromCfi(loc.start.cfi))) : undefined
    opts.onPosition({ loc: loc.start.cfi, percent, anchor: anchorOf(loc), byTurn })
  }
  rendition.on('relocated', (loc) => {
    const byTurn = turning
    turning = false
    report(loc, byTurn)
  })
  const next = () => { turning = true; void rendition.next() }
  const prev = () => { turning = false; void rendition.prev() }
  rendition.on('selected', (cfi, contents) => {
    const quote = contents.window.getSelection()?.toString().trim() ?? ''
    if (quote !== '') opts.onSelect({ quote, loc: cfi })
  })
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') prev()
    if (e.key === 'ArrowRight') next()
  }
  rendition.on('keyup', onKey)

  // 查词：轻点（不是拖选、不是双击、不在链接上）一个英文单词。移植自原型 word-lookup.js 的 bind()
  rendition.hooks.content.register((contents) => {
    const doc = contents.document
    let press: { x: number; y: number; time: number; moved: boolean } | undefined
    doc.addEventListener('pointerdown', (e) => {
      opts.onPress?.()
      press = e.button === 0 && opts.lookup?.() !== false ? { x: e.clientX, y: e.clientY, time: performance.now(), moved: false } : undefined
    })
    doc.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.moved = true })
    doc.addEventListener('click', (e) => {
      const tap = press
      press = undefined
      if (!tap || tap.moved || performance.now() - tap.time > 450 || e.detail > 1 || opts.onWord === undefined) return
      if ((e.target as Element | null)?.closest?.('a, button, input, textarea, select')) return
      if (doc.getSelection()?.isCollapsed === false) return
      const found = wordFromPoint(doc, e.clientX, e.clientY)
      const frame = doc.defaultView?.frameElement
      if (!found || !frame) return
      const r = frame.getBoundingClientRect()
      opts.onWord(found.word, { left: r.left + found.rect.left, right: r.left + found.rect.right, top: r.top + found.rect.top, bottom: r.top + found.rect.bottom })
    })
  })
  document.addEventListener('keyup', onKey)

  await rendition.display(opts.initialLoc || undefined).catch(() => rendition.display())
  for (const cfi of opts.highlights) highlight(cfi)
  // 外层面板变宽变窄（拖动右侧栏、窗口缩放）：按新尺寸重新分页，停在原来的位置
  let lastSize = `${el.clientWidth}x${el.clientHeight}`
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  const observer = new ResizeObserver(() => {
    const size = `${el.clientWidth}x${el.clientHeight}`
    if (size === lastSize || el.clientWidth === 0) return
    lastSize = size
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(async () => {
      const here = await rendition.currentLocation()
      rendition.spread(spreadFor(el))
      rendition.resize(el.clientWidth, el.clientHeight)
      if (here?.start) await rendition.display(here.start.cfi).catch(() => undefined)
    }, 150)
  })
  observer.observe(el)

  if (toc.length > 0) opts.onToc(outlineOf(toc))
  // 精确进度要先切分全书，大书要几秒，放到后台；切完后按当前位置重新回报一次
  void book.locations.generate(1600).then(async () => {
    locationsReady = true
    const loc = await rendition.currentLocation()
    if (loc?.start) report(loc, false)
  }).catch(() => undefined)

  function highlight(cfi: string) {
    try { rendition.annotations.highlight(cfi, {}, () => opts.onHighlight(cfi), 'mp-hl', { fill: opts.mark, 'fill-opacity': '0.45' }) } catch { /* 旧位置在新版本书里不存在 */ }
  }

  return {
    prev,
    next,
    goTo: (loc) => { turning = false; void rendition.display(loc).catch(() => undefined) },
    highlight,
    unhighlight: (cfi) => { try { rendition.annotations.remove(cfi, 'highlight') } catch { /* 已经没有了 */ } },
    clearSelection: () => { for (const c of rendition.getContents()) c.window.getSelection()?.removeAllRanges() },
    setFontSize: px => rendition.themes.override('font-size', `${px}px`, true),
    seek: (p) => {
      if (!locationsReady) return false
      turning = false
      void rendition.display(book.locations.cfiFromPercentage(Math.max(0, Math.min(1, p)))).catch(() => undefined)
      return true
    },
    destroy: () => {
      observer.disconnect()
      clearTimeout(resizeTimer)
      document.removeEventListener('keyup', onKey)
      rendition.destroy()
      book.destroy()
    },
  }
}
