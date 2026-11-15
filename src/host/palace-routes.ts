/**
 * v0.2 宫殿的 HTTP 接口和「添加书」。
 *
 * 过渡期：v0.1 的界面（右侧栏）还在用 rev / op，所以 v0.2 暂时用 palace/rev、palace/op；
 * 右侧栏换成笔记本（#5）后，删掉 v0.1 的路由，再改回 CONTRACT §5 的路径。
 */
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, sep } from 'node:path'
import * as core from '../core/ops.ts'
import { ShelfError, type PalaceStore } from '../core/store.ts'
import type { SourceRef } from '../shared/palace.ts'
import { readVideoCourse } from './bilibili.ts'
import { readPdfInfo } from './pdf.ts'

const API = '/api/dsh-shelf'

export interface FetchRoute {
  path: string
  methods: ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

type Op = (store: PalaceStore, args: never) => Promise<unknown>

/** 前端可调用的写操作白名单。 */
const OPS: Record<string, Op> = {
  addCell: core.addCell,
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

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/**
 * 添加一本书：先读原文（PDF 页数和书签、B 站分 P），再一次性建格子。
 * 读原文要等待，所以放在 mutate 之外。
 */
export async function addBook(store: PalaceStore, args: { file?: unknown; url?: unknown; title?: unknown; parentId?: unknown; targetDate?: unknown }) {
  let source: SourceRef
  let title: string
  let outline: core.OutlineInput[] = []
  let outlineSource: 'bookmarks' | 'video' | undefined
  if (typeof args.url === 'string' && args.url.trim() !== '') {
    const course = await readVideoCourse(args.url.trim()).catch((error: Error) => { throw new ShelfError(error.message) })
    source = { type: 'video', url: course.url }
    title = course.title
    outline = course.chapters.map(c => ({ title: c.title, sections: c.episodes.map(e => ({ title: e.title, loc: e.url })) }))
    outlineSource = 'video'
  } else if (typeof args.file === 'string' && args.file.trim() !== '') {
    const file = expandHome(args.file.trim().replace(/^['"]|['"]$/g, ''))
    if (!isAbsolute(file)) throw new ShelfError('请提供 PDF 的完整路径（以 / 开头）')
    if (!existsSync(file) || !statSync(file).isFile()) throw new ShelfError(`找不到文件：${file}`)
    if (extname(file).toLowerCase() !== '.pdf') throw new ShelfError('目前只支持 PDF 文件（EPUB 在做了）')
    const info = await readPdfInfo(file).catch((error: Error) => { throw new ShelfError(`PDF 打不开：${error.message}`) })
    source = { type: 'pdf', path: file, pageCount: info.pageCount }
    title = basename(file, extname(file))
    outline = info.outline.map(c => ({
      title: c.title,
      ...(c.page !== undefined ? { loc: String(c.page) } : {}),
      sections: c.sections.map(s => ({ title: s.title, ...(s.page !== undefined ? { loc: String(s.page) } : {}) })),
    }))
    outlineSource = 'bookmarks'
  } else {
    throw new ShelfError('请选择 PDF 文件，或粘贴视频链接')
  }
  if (typeof args.title === 'string' && args.title.trim() !== '') title = args.title.trim()
  return core.addCell(store, { kind: 'book', title, source, parentId: args.parentId, targetDate: args.targetDate, outline, outlineSource })
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

function displayPath(path: string): string {
  const home = homedir()
  return path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
}

export function createPalaceRoutes(store: PalaceStore): FetchRoute[] {
  const route = (method: 'GET' | 'POST', path: string, handler: (input: { url: URL; body: Record<string, unknown> }) => Promise<Response> | Response): FetchRoute => ({
    path: `${API}/${path}`,
    methods: [method],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = method === 'POST' ? (await request.json().catch(() => ({})) as Record<string, unknown>) ?? {} : {}
        return await handler({ url: new URL(request.url), body })
      } catch (error) {
        return fail(error)
      }
    },
  })

  return [
    route('GET', 'palace', () => {
      const palace = store.getPalace()
      return json({ ok: true, rev: store.rev, palace, summaries: store.summaries(), dataDir: displayPath(store.dir) })
    }),

    route('GET', 'item', ({ url }) => {
      const id = url.searchParams.get('id') ?? ''
      const cell = store.getPalace().cells.find(c => c.id === id)
      if (cell === undefined || cell.kind === 'group') throw new ShelfError('格子不存在')
      return json({ ok: true, rev: store.rev, item: store.getItem(id) })
    }),

    route('GET', 'palace/rev', () => {
      store.getPalace() // 顺便检查文件是否被手动修改
      return json({ ok: true, rev: store.rev })
    }),

    route('POST', 'palace/op', async ({ body }) => {
      const name = String(body.op)
      const handler = name === 'addBook' ? addBook : OPS[name]
      if (handler === undefined) return json({ ok: false, error: `未知操作 ${name}` }, 400)
      const result = await handler(store, (body.args ?? {}) as never)
      return json({ ok: true, rev: store.rev, result: result ?? null })
    }),
  ]
}
