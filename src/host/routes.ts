/**
 * 前端 ↔ Host 的 HTTP 接口。挂在 Harness 的 /api 通道上（已带鉴权），全部是精确路径。
 * 接口清单见 docs/CONTRACT.md §5。
 */
import { execFile, spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import * as core from '../core/ops.ts'
import { assertCellId, ShelfError, type PalaceStore } from '../core/store.ts'
import { findSection, type Item } from '../shared/palace.ts'
import { addBook } from './books.ts'
import { pdfjsDistDir, readPageTexts, SCANNED_THRESHOLD } from './pdf.ts'

export const API = '/api/dsh-shelf'

/** 每个对话当前打开的格子（前端上报，AI 记卡片时默认记到这里）。sessionId → 格子 id。 */
export type ActiveItems = Map<string, string>

export interface FetchRoute {
  path: string
  methods: ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

type Op = (store: PalaceStore, args: never, signal?: AbortSignal) => Promise<unknown>

/** HTTP 只能新建分组和笔记；书要走 addBook，经过原文校验（不信任前端传来的 source）。 */
function addCell(store: PalaceStore, args: Record<string, unknown>): Promise<unknown> {
  if (args.kind === 'book' || args.source !== undefined) throw new ShelfError('添加书请用 addBook')
  return core.addCell(store, { ...args, outline: undefined, outlineSource: undefined } as never)
}

/** 前端可调用的写操作白名单。 */
const OPS: Record<string, Op> = {
  addBook,
  addCell,
  updateCell: core.updateCell,
  moveCell: core.moveCell,
  deleteCell: core.deleteCell,
  updateItem: core.updateItem,
  setPosition: core.setPosition,
  setOutline: core.setOutline,
  setSectionDone: core.setSectionDone,
  markUpTo: core.markUpTo,
  resetProgress: core.resetProgress,
  addCard: core.addCard,
  updateCard: core.updateCard,
  deleteCard: core.deleteCard,
  addInspiration: core.addInspiration,
  updateInspiration: core.updateInspiration,
  deleteInspiration: core.deleteInspiration,
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function fail(error: unknown): Response {
  if (error instanceof ShelfError) return json({ ok: false, error: error.message }, 400)
  console.error('[dsh-shelf]', error)
  return json({ ok: false, error: `内部错误：${(error as Error)?.message ?? String(error)}` }, 500)
}

function streamFile(file: string, type: string): Response {
  const size = statSync(file).size
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream
  return new Response(body, { headers: { 'content-type': type, 'content-length': String(size), 'cache-control': 'no-store' } })
}

/** 界面上显示路径时把用户目录换成 ~，避免截图泄露本机用户名。 */
function displayPath(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
}

/** 用系统默认程序打开文件或网址。 */
export function openExternal(target: string): void {
  const child = process.platform === 'darwin'
    ? spawn('open', [target], { detached: true, stdio: 'ignore' })
    : process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('xdg-open', [target], { detached: true, stdio: 'ignore' })
  child.on('error', error => console.error('[dsh-shelf] 打开失败', target, error))
  child.unref()
}

/** macOS：弹出系统文件选择框选 PDF / EPUB。其它平台返回 undefined（前端退回手动粘贴路径）。 */
function pickBook(): Promise<string | null | undefined> {
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile('osascript', [
      '-e', 'set f to choose file with prompt "选择 PDF 或 EPUB" of type {"com.adobe.pdf", "org.idpf.epub-container"}',
      '-e', 'POSIX path of f',
    ], { timeout: 10 * 60_000 }, (error, stdout) => {
      if (error) resolve(null) // 用户取消
      else resolve(stdout.trim())
    })
  })
}

/** 阅读器脚本（vendor/，随 npm 包发布），只有这几个文件能被读取。 */
const READER_SCRIPTS = ['jszip.min.js', 'epub.min.js']

/** vendor/ 在包根目录：构建后从 lib/index.js 找，开发和测试时从 src/host/routes.ts 找。 */
function vendorDir(): string {
  const built = fileURLToPath(new URL('../vendor/', import.meta.url))
  return existsSync(built) ? built : fileURLToPath(new URL('../../vendor/', import.meta.url))
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

/** 书 / 笔记格子的内容；分组或不存在就报错。 */
function itemOf(store: PalaceStore, id: unknown): Item {
  assertCellId(id)
  const cell = store.getPalace().cells.find(c => c.id === id)
  if (cell === undefined || cell.kind === 'group') throw new ShelfError('格子不存在')
  return store.getItem(id)
}

export function createRoutes(store: PalaceStore, active: ActiveItems): FetchRoute[] {
  const route = (method: 'GET' | 'POST', path: string, handler: (input: { url: URL; body: Record<string, unknown>; signal: AbortSignal }) => Promise<Response> | Response): FetchRoute => ({
    path: `${API}/${path}`,
    methods: [method],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = method === 'POST' ? (await request.json().catch(() => ({})) as Record<string, unknown>) ?? {} : {}
        return await handler({ url: new URL(request.url), body, signal: request.signal })
      } catch (error) {
        return fail(error)
      }
    },
  })

  return [
    route('GET', 'palace', () => json({
      ok: true, rev: store.rev, palace: store.getPalace(), summaries: store.summaries(), dataDir: displayPath(store.dir),
    })),

    // 宫殿里的 AI 对话建在数据目录这个工作区下（左侧会话列表里归在一起）；绝对路径只给前端建会话用，不显示
    route('GET', 'chat-workspace', () => json({ ok: true, cwd: store.dir })),

    route('GET', 'item', ({ url }) => json({ ok: true, rev: store.rev, item: itemOf(store, url.searchParams.get('id')) })),

    route('GET', 'rev', () => json({ ok: true, rev: store.checkDisk() })),

    route('POST', 'op', async ({ body, signal }) => {
      const name = String(body.op)
      const handler = Object.hasOwn(OPS, name) ? OPS[name] : undefined
      if (handler === undefined) return json({ ok: false, error: `未知操作 ${name}` }, 400)
      const result = await handler(store, (body.args ?? {}) as never, signal)
      return json({ ok: true, rev: store.rev, result: result ?? null })
    }),

    // 原文字节：只给格子里登记过的路径
    route('GET', 'file', ({ url }) => {
      const source = itemOf(store, url.searchParams.get('id')).source
      if (source === null || source.type === 'video') throw new ShelfError('这个格子没有原文文件')
      if (!existsSync(source.path)) return json({ ok: false, error: '找不到原文文件，可能被移动或删除了' }, 404)
      return streamFile(source.path, source.type === 'pdf' ? 'application/pdf' : 'application/epub+zip')
    }),

    route('GET', 'page-text', async ({ url }) => {
      const source = itemOf(store, url.searchParams.get('id')).source
      if (source?.type !== 'pdf') throw new ShelfError('这不是 PDF')
      const pages = (url.searchParams.get('pages') ?? '').split(',').map(Number).filter(Number.isInteger)
      const texts = await readPageTexts(source.path, pages)
      const scanned = texts.filter(t => t.text.length < SCANNED_THRESHOLD).map(t => t.page)
      return json({ ok: true, pages: texts, scanned })
    }),

    route('GET', 'image', ({ url }) => {
      const name = basename(url.searchParams.get('name') ?? '')
      const file = join(store.imagesDir, name)
      const type = IMAGE_TYPES[extname(name).toLowerCase()]
      if (name === '' || type === undefined || !existsSync(file)) return new Response('not found', { status: 404 })
      return streamFile(file, type)
    }),

    // 前端按需加载的资源：阅读器脚本 ?f=reader/epub.min.js；pdf.js 的 CMap / 标准字体 / wasm：?f=cmaps/UniGB-UCS2-H.bcmap
    route('GET', 'asset', ({ url }) => {
      const rel = normalize(url.searchParams.get('f') ?? '')
      if (rel.startsWith('reader/')) {
        const name = rel.slice('reader/'.length)
        if (!READER_SCRIPTS.includes(name)) return new Response('not found', { status: 404 })
        const response = streamFile(join(vendorDir(), name), 'text/javascript; charset=utf-8')
        response.headers.set('cache-control', 'public, max-age=86400')
        return response
      }
      const allowed = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
      if (!allowed.some(dir => rel.startsWith(dir + sep)) || rel.includes('..')) return new Response('not found', { status: 404 })
      const file = join(pdfjsDistDir(), rel)
      if (!existsSync(file)) return new Response('not found', { status: 404 })
      const response = streamFile(file, file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
      response.headers.set('cache-control', 'public, max-age=31536000, immutable')
      return response
    }),

    route('POST', 'pick-file', async () => json({ ok: true, path: await pickBook() })),

    // 只打开格子里登记过的东西，不接受任意路径
    route('POST', 'open', ({ body }) => {
      if (body.target === 'dataDir') {
        openExternal(store.dir)
        return json({ ok: true })
      }
      const item = itemOf(store, body.id)
      const section = findSection(item, typeof body.sectionId === 'string' ? body.sectionId : undefined)?.section
      const source = item.source
      if (source === null) throw new ShelfError('这个格子没有原文')
      if (source.type === 'video') {
        // 视频的节 loc 是这一集的链接
        const loc = section?.loc
        openExternal(loc !== undefined && /^https?:\/\//.test(loc) ? loc : source.url)
        return json({ ok: true })
      }
      if (!existsSync(source.path)) throw new ShelfError(`找不到文件：${displayPath(source.path)}`)
      openExternal(source.path)
      return json({ ok: true })
    }),

    route('POST', 'active', ({ body }) => {
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      if (sessionId === undefined) return json({ ok: false, error: '缺少 sessionId' }, 400)
      if (typeof body.itemId === 'string') active.set(sessionId, body.itemId)
      else active.delete(sessionId)
      return json({ ok: true })
    }),
  ]
}
