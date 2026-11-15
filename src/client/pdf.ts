/**
 * 前端 PDF 渲染（pdf.js）：缩略图、把选中的页渲染成图片发给 AI。
 * Worker 用 Blob URL 启动（和官方文档预览一样的做法），CMap 等资源从 Host 读取。
 */
import { getDocument, PDFWorker, type PDFDocumentProxy } from 'pdfjs-dist'
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import { apiUrl } from './api.ts'

let sharedWorker: PDFWorker | undefined

function pdfWorker(): PDFWorker {
  if (sharedWorker === undefined) {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    sharedWorker = new PDFWorker({ port: new Worker(url, { type: 'module', name: 'dsh-shelf-pdf' }) as never })
  }
  return sharedWorker
}

/** pdf.js 拼接方式是 `${base}${filename}`，所以 base 以 "?f=目录/" 结尾即可。 */
function assetBase(dir: string): string {
  return `${apiUrl('asset')}?f=${dir}/`
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

/** 打开书架里某本 PDF（同一本只加载一次）。 */
export function loadPdf(id: string): Promise<PDFDocumentProxy> {
  let doc = docs.get(id)
  if (doc === undefined) {
    doc = (async () => {
      const response = await fetch(apiUrl('file', { id: id }))
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `PDF 读取失败（HTTP ${response.status}）`)
      }
      const data = new Uint8Array(await response.arrayBuffer())
      return getDocument({
        data,
        worker: pdfWorker(),
        cMapUrl: assetBase('cmaps'),
        cMapPacked: true,
        standardFontDataUrl: assetBase('standard_fonts'),
        wasmUrl: assetBase('wasm'),
        ...({ isEvalSupported: false } as object), // pdf.js 6 的类型里去掉了这个选项；旧版本仍然认，保留
      }).promise
    })()
    doc.catch(() => docs.delete(id))
    docs.set(id, doc)
  }
  return doc
}

/** 释放 PDF（离开选页界面时调用，节省内存）。 */
export function releasePdf(id: string): void {
  const doc = docs.get(id)
  docs.delete(id)
  void doc?.then(d => (d as unknown as { destroy?: () => Promise<void> }).destroy?.()).catch(() => undefined)
}

/** 把一页渲染到 canvas，宽度为 width 像素（按设备像素比放大）。 */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, width: number, signal?: AbortSignal): Promise<void> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const ratio = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: (width / base.width) * ratio })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${width}px`
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`
  const task = page.render({ canvas, viewport })
  const abort = () => task.cancel()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await task.promise
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

/** 把指定页渲染成 JPEG 文件（长边约 1600px），用于发给 AI 识别扫描版目录。 */
export async function pagesToFiles(id: string, pages: number[], title: string): Promise<File[]> {
  const doc = await loadPdf(id)
  const files: File[] = []
  for (const n of pages) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const scale = 1600 / Math.max(base.width, base.height)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('页面转图片失败'))), 'image/jpeg', 0.85)
    })
    files.push(new File([blob], `${title}-第${n}页.jpg`, { type: 'image/jpeg' }))
  }
  return files
}
