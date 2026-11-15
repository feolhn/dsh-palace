// Host：HTTP 接口和 AI 工具。node --test test/host.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PalaceStore } from '../src/core/store.ts'
import * as core from '../src/core/ops.ts'
import { createRoutes } from '../src/host/routes.ts'

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
