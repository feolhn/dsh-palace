// Host：HTTP 接口和 AI 工具。node --test test/host.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PalaceStore } from '../src/core/store.ts'
import * as core from '../src/core/ops.ts'
import { createRoutes } from '../src/host/routes.ts'
import { addBook } from '../src/host/books.ts'

const fresh = () => new PalaceStore(mkdtempSync(join(tmpdir(), 'dsh-host-')))

function api(store, active = new Map()) {
  const routes = Object.fromEntries(createRoutes(store, active).map(r => [r.path.replace('/api/dsh-shelf/', ''), r]))
  return async (name, { query = '', body } = {}) => {
    const r = routes[name]
    const res = await r.fetch(new Request(`http://x/api/dsh-shelf/${name}${query}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }))
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() }
  }
}

test('路由：宫殿、格子、写操作白名单、业务错误返回 400', async () => {
  const store = fresh()
  const call = api(store)
  let r = await call('op', { body: { op: 'addCell', args: { kind: 'note', title: '心情' } } })
  assert.equal(r.status, 200)
  const id = r.body.result.id
  r = await call('palace')
  assert.equal(r.body.palace.cells.length, 1)
  assert.equal(r.body.summaries[id].cards, 0)
  r = await call('item', { query: `?id=${id}` })
  assert.equal(r.body.item.id, id)
  r = await call('op', { body: { op: 'addCell', args: { kind: 'note', title: '' } } })
  assert.deepEqual([r.status, r.body.error], [400, '标题不能为空'])
  r = await call('op', { body: { op: 'hack', args: {} } })
  assert.equal(r.status, 400)
  r = await call('op', { body: { op: 'toString', args: {} } })
  assert.equal(r.status, 400, '原型链上的名字不能当成操作')
  r = await call('item', { query: '?id=../../etc' })
  assert.equal(r.status, 400)
  r = await call('rev')
  assert.ok(r.body.rev > 0)
})

test('路由：原文和图片只给登记过的、不能穿越目录', async () => {
  const store = fresh()
  const call = api(store)
  const note = await core.addCell(store, { kind: 'note', title: 'N' })
  let r = await call('file', { query: `?id=${note.id}` })
  assert.equal(r.status, 400, '笔记格子没有原文')
  const missing = await core.addCell(store, { kind: 'book', title: 'B', source: { type: 'pdf', path: '/nope/x.pdf', pageCount: 1 } })
  r = await call('file', { query: `?id=${missing.id}` })
  assert.equal(r.status, 404)
  writeFileSync(join(store.imagesDir, 'img_1.png'), 'x')
  r = await call('image', { query: '?name=img_1.png' })
  assert.equal(r.status, 200)
  r = await call('image', { query: '?name=../palace.json' })
  assert.equal(r.status, 404)
  r = await call('asset', { query: '?f=../package.json' })
  assert.equal(r.status, 404)
})

test('路由：active 记录每个对话打开的格子', async () => {
  const store = fresh()
  const active = new Map()
  const call = api(store, active)
  await call('active', { body: { sessionId: 's1', itemId: 'c_0000000001' } })
  assert.equal(active.get('s1'), 'c_0000000001')
  await call('active', { body: { sessionId: 's1', itemId: null } })
  assert.equal(active.has('s1'), false)
})

test('路由：HTTP 不能直接用 addCell 登记原文（书要走 addBook 的校验）', async () => {
  const call = api(fresh())
  let r = await call('op', { body: { op: 'addCell', args: { kind: 'book', title: 'x', source: { type: 'pdf', path: '/tmp/x.txt', pageCount: 1 } } } })
  assert.deepEqual([r.status, r.body.error], [400, '添加书请用 addBook'])
  r = await call('op', { body: { op: 'addCell', args: { kind: 'note', title: 'x', source: { type: 'pdf', path: '/tmp/x.txt', pageCount: 1 } } } })
  assert.equal(r.status, 400)
})

test('rev：手改 item 文件后 rev 会变，界面能刷新', async () => {
  const store = fresh()
  const call = api(store)
  const n = await core.addCell(store, { kind: 'note', title: 'N' })
  const before = (await call('rev')).body.rev
  assert.equal((await call('rev')).body.rev, before)
  const file = join(store.dir, 'items', `${n.id}.json`)
  const item = JSON.parse(readFileSync(file, 'utf8'))
  item.targetDate = '2099-01-01'
  writeFileSync(file, JSON.stringify(item, null, 2) + '\n')
  utimesSync(file, new Date(), new Date(Date.now() + 5000))
  assert.ok((await call('rev')).body.rev > before)
})

test('addBook：取消后不建格子（网络请求已经发出、晚些才返回也一样）', async () => {
  const store = fresh()
  const realFetch = globalThis.fetch
  const controller = new AbortController()
  // 假的 B 站接口：不理会取消信号，过一会儿照常返回
  globalThis.fetch = async () => {
    controller.abort()
    return new Response(JSON.stringify({ code: 0, data: { bvid: 'BV1234567890', title: '课', pages: [{ page: 1, part: '一' }] } }))
  }
  try {
    await assert.rejects(addBook(store, { url: 'https://www.bilibili.com/video/BV1234567890' }, controller.signal), /已取消/)
    assert.equal(store.getPalace().cells.length, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})
