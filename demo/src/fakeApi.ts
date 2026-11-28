/**
 * 假的插件接口：拦截 /api/dsh-palace/ 下的请求，返回构建时算好的演示数据（assets/demo/data.json，见 demo/snapshot.ts）。
 * 宫殿画布、阅览室用的是插件的真实组件，它们照常请求接口，不知道自己在演示站里。
 * 基本只读：挪格子、拖成组、改名、换图标用 Core 自己的 ops 在内存里改（刷新就复原），别的修改一律拒绝；
 * 「用浏览器打开」（视频、带网址的格子）照常打开。
 */
import { groupCells, moveCell, updateCell } from '../../src/core/ops.ts'
import type { PalaceStore } from '../../src/core/store.ts'
import type { Snapshot } from '../snapshot.ts'
import { memStore } from './memStore.ts'

let data: Snapshot | undefined
let store: PalaceStore | undefined
let rev = 1

/** 访客可以试的修改：只动布局和格子外观，规则和插件完全一样 */
const TRY_OPS: Record<string, (store: PalaceStore, args: never) => Promise<unknown>> = { moveCell, groupCells, updateCell }

export async function loadDemo(): Promise<Snapshot> {
  data = await (await fetch('assets/demo/data.json')).json() as Snapshot
  store = memStore(data)
  return data
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fail = (error: string, status = 400) => json({ ok: false, error }, status)
const READ_ONLY = '这里是演示，暂时不能修改。装上插件后，就能放进你自己的东西了'

/** 插件里「用系统程序打开」：网址就在新标签页打开，本地文件演示站没有 */
async function open(d: Snapshot, init: RequestInit | undefined): Promise<Response> {
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { id?: string; sectionId?: string; target?: string }
  const web = (u: string | undefined) => u !== undefined && /^https?:\/\//.test(u) ? u : undefined
  const cell = d.palace.cells.find(c => c.id === body.id)
  const source = body.id === undefined ? undefined : d.items[body.id]?.source
  const loc = source?.type === 'video'
    ? d.items[body.id!]?.chapters.flatMap(ch => ch.sections).find(s => s.id === body.sectionId)?.loc
    : undefined
  const url = body.target === 'welcome' ? location.href : web(cell?.href) ?? web(loc) ?? (source?.type === 'video' ? web(source.url) : undefined)
  if (url === undefined) return fail('演示站里打不开本地文件。装上插件后，会用你电脑上的程序打开')
  window.open(url, '_blank', 'noopener')
  return json({ ok: true })
}

function handle(path: string, url: URL, init: RequestInit | undefined, real: typeof fetch): Response | Promise<Response> {
  const d = data
  if (d === undefined) return fail('演示还没准备好', 503)
  const id = url.searchParams.get('id') ?? ''
  switch (path) {
    case 'rev': return json({ ok: true, rev })
    case 'palace': return json({ ok: true, rev, palace: d.palace, summaries: d.summaries, dataDir: '演示数据' })
    case 'item': return d.items[id] === undefined ? fail('找不到这个格子', 404) : json({ ok: true, rev, item: d.items[id] })
    case 'arcs': return json({ ok: true, rev, arcs: d.arcs })
    // 原文和原图：构建时从 demo/data/files、images 复制过来，source.path 写文件名
    case 'file': {
      const s = d.items[id]?.source
      return s === undefined || s === null || s.type === 'video' ? fail('找不到这个文件', 404) : real(`assets/demo/files/${encodeURIComponent(s.path.split('/').pop()!)}`)
    }
    case 'image': return real(`assets/demo/images/${encodeURIComponent((url.searchParams.get('name') ?? '').split('/').pop()!)}`)
    case 'open': return open(d, init)
    case 'op': {
      const { op, args } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { op?: string; args?: unknown }
      const run = op === undefined ? undefined : TRY_OPS[op]
      if (run === undefined || store === undefined) return fail(READ_ONLY)
      return run(store, (args ?? {}) as never).then(
        (result) => { rev += 1; return json({ ok: true, rev, result: result ?? null }) },
        (e: Error) => fail(e.message),
      )
    }
    // 打开对话时上报当前格子：演示里没人听，回个成功就行
    case 'active': return json({ ok: true })
    default: return fail(READ_ONLY)
  }
}

export function installFakeApi(): void {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, document.baseURI)
    const m = /\/api\/dsh-palace\/([a-z-]+)$/.exec(url.pathname)
    return m === null ? real(input, init) : handle(m[1], url, init, real)
  }
}
