/**
 * 前端 ↔ Host 的 HTTP 接口。挂在 Harness 的 /api 通道上（已带鉴权），全部是精确路径。
 * 接口清单见 docs/CONTRACT.md。
 */
import { execFile, spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { homedir } from 'node:os'
import { findSection } from '../shared/model.ts'
import * as ops from './ops.ts'
import { pdfjsDistDir, readPageTexts, SCANNED_THRESHOLD } from './pdf.ts'
import type { ShelfStore } from './store.ts'
import type { ActiveMaterials } from './tools.ts'

export const API = '/api/dsh-shelf'

export interface FetchRoute {
  path: string
  methods: ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function fail(error: unknown): Response {
  if (error instanceof ops.ShelfError) return json({ ok: false, error: error.message }, 400)
  console.error('[dsh-shelf]', error)
  return json({ ok: false, error: `内部错误：${(error as Error)?.message ?? String(error)}` }, 500)
}

function streamFile(file: string, type: string): Response {
  const size = statSync(file).size
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream
  return new Response(body, { headers: { 'content-type': type, 'content-length': String(size), 'cache-control': 'no-store' } })
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

/** macOS：弹出系统文件选择框选 PDF。其它平台返回 undefined（前端退回手动粘贴路径）。 */
function pickPdf(): Promise<string | null | undefined> {
  if (process.platform !== 'darwin') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile('osascript', [
      '-e', 'set f to choose file with prompt "选择 PDF 教材" of type {"com.adobe.pdf"}',
      '-e', 'POSIX path of f',
    ], { timeout: 10 * 60_000 }, (error, stdout) => {
      if (error) resolve(null) // 用户取消
      else resolve(stdout.trim())
    })
  })
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

type OpHandler = (store: ShelfStore, args: never) => Promise<unknown>

/** 前端可调用的写操作白名单。 */
const OPS: Record<string, OpHandler> = {
  addGoal: ops.addGoal,
  updateGoal: ops.updateGoal,
  deleteGoal: ops.deleteGoal,
  addSubject: ops.addSubject,
  updateSubject: ops.updateSubject,
  deleteSubject: ops.deleteSubject,
  addBook: ops.addBook,
  addVideo: ops.addVideo,
  updateMaterial: ops.updateMaterial,
  deleteMaterial: ops.deleteMaterial,
  setOutline: ops.setOutline,
  setSectionDone: ops.setSectionDone,
  markUpTo: ops.markUpTo,
  resetProgress: ops.resetProgress,
  updateMistake: ops.updateMistake,
  deleteMistake: ops.deleteMistake,
}

export function createRoutes(store: ShelfStore, active: ActiveMaterials): FetchRoute[] {
  const get = (path: string, handler: (url: URL) => Promise<Response> | Response): FetchRoute => ({
    path: `${API}/${path}`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        return await handler(new URL(request.url))
      } catch (error) {
        return fail(error)
      }
    },
  })
  const post = (path: string, handler: (body: Record<string, unknown>) => Promise<Response> | Response): FetchRoute => ({
    path: `${API}/${path}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        return await handler(body ?? {})
      } catch (error) {
        return fail(error)
      }
    },
  })

  return [
    get('library', () => json({ ok: true, rev: store.rev, library: store.get(), dataDir: displayPath(store.dir) })),

    get('rev', () => {
      store.get() // 顺便检查文件是否被手动修改
      return json({ ok: true, rev: store.rev })
    }),

    post('op', async (body) => {
      const name = String(body.op)
      const handler = OPS[name]
      if (handler === undefined) return json({ ok: false, error: `未知操作 ${name}` }, 400)
      const result = await handler(store, (body.args ?? {}) as never)
      return json({ ok: true, rev: store.rev, result: result ?? null })
    }),

    get('pdf', (url) => {
      const m = ops.material(store.get(), url.searchParams.get('id') ?? '')
      if (m.file === undefined || !existsSync(m.file)) return json({ ok: false, error: '找不到 PDF 文件，可能被移动或删除了' }, 404)
      return streamFile(m.file, 'application/pdf')
    }),

    get('page-text', async (url) => {
      const m = ops.material(store.get(), url.searchParams.get('id') ?? '')
      if (m.file === undefined) throw new ops.ShelfError('这不是 PDF 资料')
      const pages = (url.searchParams.get('pages') ?? '').split(',').map(Number).filter(Number.isInteger)
      const texts = await readPageTexts(m.file, pages)
      const scanned = texts.filter(t => t.text.length < SCANNED_THRESHOLD).map(t => t.page)
      return json({ ok: true, pages: texts, scanned })
    }),

    get('image', (url) => {
      const name = basename(url.searchParams.get('name') ?? '')
      const file = join(store.imagesDir, name)
      const type = IMAGE_TYPES[extname(name).toLowerCase()]
      if (name === '' || type === undefined || !existsSync(file)) return new Response('not found', { status: 404 })
      return streamFile(file, type)
    }),

    // pdf.js 前端渲染需要的 CMap / 标准字体 / wasm：?f=cmaps/UniGB-UCS2-H.bcmap
    get('asset', (url) => {
      const rel = normalize(url.searchParams.get('f') ?? '')
      const root = pdfjsDistDir()
      const allowed = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
      if (!allowed.some(dir => rel.startsWith(dir + sep)) || rel.includes('..')) return new Response('not found', { status: 404 })
      const file = join(root, rel)
      if (!existsSync(file)) return new Response('not found', { status: 404 })
      const type = file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
      const response = streamFile(file, type)
      response.headers.set('cache-control', 'public, max-age=31536000, immutable')
      return response
    }),

    post('pick-file', async () => json({ ok: true, path: await pickPdf() })),

    // 只打开书架里登记过的东西，不接受任意路径
    post('open', (body) => {
      const lib = store.get()
      if (body.target === 'dataDir') {
        openExternal(store.dir)
        return json({ ok: true })
      }
      const m = ops.material(lib, String(body.materialId ?? ''))
      const section = findSection(m, typeof body.sectionId === 'string' ? body.sectionId : undefined)?.section
      const target = section?.url ?? m.file ?? m.url
      if (target === undefined) throw new ops.ShelfError('没有可以打开的文件或链接')
      if (m.file !== undefined && target === m.file && !existsSync(m.file)) throw new ops.ShelfError(`找不到文件：${m.file}`)
      openExternal(target)
      return json({ ok: true })
    }),

    post('active', (body) => {
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      if (sessionId === undefined) return json({ ok: false, error: '缺少 sessionId' }, 400)
      if (typeof body.materialId === 'string') active.set(sessionId, body.materialId)
      else active.delete(sessionId)
      return json({ ok: true })
    }),
  ]
}

/** 界面上显示路径时把用户目录换成 ~，避免截图泄露本机用户名。 */
function displayPath(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
}
