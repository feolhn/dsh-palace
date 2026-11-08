/**
 * Host 端 PDF 读取（pdfjs-dist，Node 环境）：页数、书签目录、指定页文字。
 * 不渲染图片——缩略图由前端渲染。
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

const require = createRequire(import.meta.url)
let pdfjsPromise: Promise<PdfJs> | undefined

function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

/** pdfjs-dist 包目录，用于 CMap（中文 PDF 提取文字需要）和标准字体。 */
export function pdfjsDistDir(): string {
  return dirname(require.resolve('pdfjs-dist/package.json'))
}

async function open(file: string): Promise<{ doc: PdfDocument; close: () => Promise<void> }> {
  const lib = await pdfjs()
  const data = new Uint8Array(await readFile(file))
  const dist = pdfjsDistDir()
  const task = lib.getDocument({
    data,
    cMapUrl: join(dist, 'cmaps') + sep, // Node 端要普通路径，不能是 file:// URL
    cMapPacked: true,
    standardFontDataUrl: join(dist, 'standard_fonts') + sep,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const doc = await task.promise
  return { doc, close: () => task.destroy() }
}

export interface OutlineSection { title: string; page?: number }
export interface OutlineChapter { title: string; page?: number; sections: OutlineSection[] }

export interface PdfInfo {
  pageCount: number
  title?: string
  /** 书签目录（两级：章 › 节）。没有书签为空数组。 */
  outline: OutlineChapter[]
}

interface RawOutlineItem {
  title: string
  dest: string | unknown[] | null
  items: RawOutlineItem[]
}

async function pageOf(doc: PdfDocument, dest: RawOutlineItem['dest']): Promise<number | undefined> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return undefined
    const ref = explicit[0]
    if (typeof ref === 'number') return ref + 1
    if (ref !== null && typeof ref === 'object') return (await doc.getPageIndex(ref as never)) + 1
  } catch {
    // 坏书签：忽略页码
  }
  return undefined
}

function clean(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

/**
 * 读取 PDF 基本信息与书签。书签只有一个顶层节点（常见：书名）时，下钻一层。
 */
export async function readPdfInfo(file: string): Promise<PdfInfo> {
  const { doc, close } = await open(file)
  try {
    let items = ((await doc.getOutline()) ?? []) as RawOutlineItem[]
    while (items.length === 1 && items[0].items.length > 0) items = items[0].items
    const outline: OutlineChapter[] = []
    for (const item of items) {
      const sections: OutlineSection[] = []
      for (const child of item.items) {
        const title = clean(child.title)
        if (title !== '') sections.push({ title, page: await pageOf(doc, child.dest) })
      }
      const title = clean(item.title)
      if (title !== '') outline.push({ title, page: await pageOf(doc, item.dest), sections })
    }
    let title: string | undefined
    try {
      const meta = await doc.getMetadata()
      const info = meta.info as { Title?: unknown } | undefined
      if (typeof info?.Title === 'string' && info.Title.trim() !== '') title = info.Title.trim()
    } catch {
      // 无元数据
    }
    return { pageCount: doc.numPages, title, outline }
  } finally {
    await close()
  }
}

export interface PageText { page: number; text: string }

/** 提取指定页的文字（按行拼接）。页码 1 起，越界的页会被跳过。 */
export async function readPageTexts(file: string, pages: readonly number[]): Promise<PageText[]> {
  const { doc, close } = await open(file)
  try {
    const out: PageText[] = []
    for (const page of pages) {
      if (!Number.isInteger(page) || page < 1 || page > doc.numPages) continue
      const p = await doc.getPage(page)
      const content = await p.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        if (item.hasEOL) text += '\n'
      }
      out.push({ page, text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() })
      p.cleanup()
    }
    return out
  } finally {
    await close()
  }
}

/** 每页少于这么多字符，就当它是扫描页（没有文字层）。 */
export const SCANNED_THRESHOLD = 20
