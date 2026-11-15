/**
 * EPUB 阅读器（epub.js）。脚本不打进插件主包，第一次打开时才从 Host 的 asset 接口加载（WORK §5.4）。
 * 这里只管渲染和事件，存位置、记卡片由外面的界面负责（CONTRACT §4.2）。
 */
import type { OutlineInput } from '../../core/ops.ts'
import { apiUrl } from '../api.ts'

/* epub.js 没有类型包，这里只声明用到的部分 */
interface EpubLocation { start: { cfi: string; href: string; index: number; percentage?: number } }
interface EpubContents { window: Window }
interface NavItem { label: string; href: string; subitems?: NavItem[] }
interface Rendition {
  display(target?: string): Promise<void>
  prev(): Promise<void>
  next(): Promise<void>
  on(event: 'relocated', fn: (loc: EpubLocation) => void): void
  on(event: 'selected', fn: (cfi: string, contents: EpubContents) => void): void
  on(event: 'keyup', fn: (e: KeyboardEvent) => void): void
  annotations: { highlight(cfi: string, data?: object, cb?: () => void, className?: string, styles?: object): void; remove(cfi: string, type: string): void }
  themes: { default(styles: object): void; override(name: string, value: string, priority?: boolean): void }
  getContents(): EpubContents[]
  destroy(): void
}
interface EpubBook {
  ready: Promise<void>
  loaded: { navigation: Promise<{ toc: NavItem[] }> }
  spine: { length: number }
  locations: { generate(chars: number): Promise<unknown>; percentageFromCfi(cfi: string): number; length(): number }
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
  clearSelection(): void
  setFontSize(px: number): void
  destroy(): void
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

export async function mountEpub(el: HTMLElement, opts: {
  data: ArrayBuffer
  initialLoc?: string
  highlights: string[]
  fontSize: number
  /** 翻页后：位置（CFI）、0–1 的进度、当前文件 href。 */
  onPosition(loc: string, percent: number, href: string): void
  /** 选中一段文字（划线）；取消选择时不回调。 */
  onSelect(sel: { quote: string; loc: string }): void
  onToc(outline: OutlineInput[]): void
}): Promise<EpubHandle> {
  const ePub = await loadEpub()
  const book = ePub(opts.data)
  await book.ready
  const rendition = book.renderTo(el, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: el.clientWidth >= 760 ? 'auto' : 'none',
    allowScriptedContent: false, // 书里的脚本一律不跑
  })
  rendition.themes.default({ body: { 'line-height': '1.8' }, '::selection': { background: '#f4dfa0' } })
  rendition.themes.override('font-size', `${opts.fontSize}px`, true)

  let locationsReady = false
  rendition.on('relocated', (loc) => {
    const percent = locationsReady
      ? book.locations.percentageFromCfi(loc.start.cfi)
      : loc.start.index / Math.max(1, book.spine.length)
    opts.onPosition(loc.start.cfi, Math.max(0, Math.min(1, percent)), loc.start.href)
  })
  rendition.on('selected', (cfi, contents) => {
    const quote = contents.window.getSelection()?.toString().trim() ?? ''
    if (quote !== '') opts.onSelect({ quote, loc: cfi })
  })
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') void rendition.prev()
    if (e.key === 'ArrowRight') void rendition.next()
  }
  rendition.on('keyup', onKey)
  document.addEventListener('keyup', onKey)

  await rendition.display(opts.initialLoc || undefined).catch(() => rendition.display())
  for (const cfi of opts.highlights) highlight(cfi)
  void book.loaded.navigation.then(nav => opts.onToc(outlineOf(nav.toc))).catch(() => undefined)
  // 精确进度要先切分全书，大书要几秒，放到后台
  void book.locations.generate(1600).then(() => { locationsReady = true }).catch(() => undefined)

  function highlight(cfi: string) {
    try { rendition.annotations.highlight(cfi, {}, undefined, 'mp-hl', { fill: '#f4dfa0', 'fill-opacity': '0.45' }) } catch { /* 旧位置在新版本书里不存在 */ }
  }

  return {
    prev: () => void rendition.prev(),
    next: () => void rendition.next(),
    goTo: loc => void rendition.display(loc).catch(() => undefined),
    highlight,
    clearSelection: () => { for (const c of rendition.getContents()) c.window.getSelection()?.removeAllRanges() },
    setFontSize: px => rendition.themes.override('font-size', `${px}px`, true),
    destroy: () => {
      document.removeEventListener('keyup', onKey)
      rendition.destroy()
      book.destroy()
    },
  }
}
