/**
 * 假的插件接口：拦截 /api/dsh-palace/ 下的请求，返回播放器当前的演示数据（只读）。
 * 宫殿画布用的是插件的真实组件，它们照常请求接口，不知道自己在演示站里。
 */
import { summaryOf, SCHEMA } from '../../src/shared/palace.ts'
import type { DemoState } from './script.ts'

let current: DemoState | undefined
let rev = 1

export function setDemoData(s: DemoState): void {
  current = s
  rev += 1
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function handle(path: string, url: URL): Response {
  const s = current
  if (s === undefined) return json({ ok: false, error: '演示还没准备好' }, 503)
  switch (path) {
    case 'rev': return json({ ok: true, rev })
    case 'palace': {
      const summaries = Object.fromEntries(s.cells.filter(c => c.kind !== 'group').map(c => [c.id, summaryOf(s.items[c.id])]))
      return json({ ok: true, rev, palace: { schema: SCHEMA, cells: s.cells }, summaries, dataDir: '演示数据' })
    }
    case 'item': {
      const item = s.items[url.searchParams.get('id') ?? '']
      return item === undefined ? json({ ok: false, error: '找不到这个格子' }, 404) : json({ ok: true, rev, item })
    }
    case 'arcs': return json({ ok: true, rev, arcs: s.arcs.map(a => ({ ...a, strands: 1, lastAt: '2026-11-01T00:00:00.000Z' })) })
    default: return json({ ok: false, error: '演示站里不能这样做' }, 400)
  }
}

export function installFakeApi(): void {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, document.baseURI)
    const m = /\/api\/dsh-palace\/([a-z-]+)$/.exec(url.pathname)
    return m === null ? real(input, init) : handle(m[1], url)
  }
}
