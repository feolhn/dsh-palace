// 记忆与电弧（#8）：node --import ./test/stubs/register.mjs --test test/memory.test.mjs
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PalaceStore } from '../src/core/store.ts'
import * as core from '../src/core/ops.ts'
import { Memory, PAGE_LIMIT } from '../src/core/memory.ts'
import { createTools } from '../src/host/tools.ts'

async function setup() {
  const store = new PalaceStore(mkdtempSync(join(tmpdir(), 'dsh-memory-')))
  const memory = new Memory(store)
  const active = new Map()
  const tools = Object.fromEntries(createTools(store, active, memory).map(t => [t.name, t]))
  const call = (name, args, session = 's1') => tools[name].execute(args, { agent: { id: session } })
  const a = await core.addCell(store, { kind: 'note', title: '了不起的盖茨比' })
  const b = await core.addCell(store, { kind: 'note', title: '十一月的心情' })
  const ka = await core.addCard(store, { id: a.id, type: 'thought', note: '绿灯是等待' })
  const kb = await core.addCard(store, { id: b.id, type: 'thought', note: '还在等 offer' })
  return { store, memory, active, call, a, b, ka, kb }
}

test('wiki：整页写、读，超过上限拒绝', async () => {
  const { memory, call, a } = await setup()
  assert.match(await call('shelf_wiki_read', { target: a.id }), /还没有 wiki/)
  assert.match(await call('shelf_wiki_write', { target: a.id, body: 'x'.repeat(PAGE_LIMIT + 1) }), /上限 500 字/)
  assert.match(await call('shelf_wiki_write', { target: a.id, body: '用户在读等待。[^k]', summary: '关于等待', topics: ['等待', '等待', '孤独'] }), /主题词：等待、孤独/)
  const page = memory.readPage(a.id)
  assert.equal(page.summary, '关于等待')
  assert.deepEqual(page.topics, ['等待', '孤独'])
  assert.equal(memory.debt(a.id), 0)
  assert.match(await call('shelf_wiki_write', { target: 'me', body: '长期：喜欢侦探小说' }), /关于用户/)
  assert.match(await call('shelf_wiki_read', { target: 'me' }), /侦探小说/)
  assert.match(await call('shelf_wiki_read', { target: '../x' }), /操作失败/)
})

test('电弧：要两端证据，同样证据不重复，新证据加股，证据删了失效', async () => {
  const { store, memory, call, a, b, ka, kb } = await setup()
  assert.match(await call('shelf_link', { from: a.id, to: b.id, why: '都在等', evidence: [ka.id] }), /两端都要/)
  assert.match(await call('shelf_link', { from: a.id, to: b.id, why: '都在等', evidence: [ka.id, 'k_0000000000'] }), /不在两端/)
  assert.match(await call('shelf_link', { from: a.id, to: b.id, why: '都在等', evidence: [ka.id, kb.id] }), /1 股/)
  assert.match(await call('shelf_link', { from: b.id, to: a.id, why: '又一次', evidence: [kb.id, ka.id] }), /已经连过/)
  const k2 = await core.addCard(store, { id: b.id, type: 'thought', note: '等待让人焦虑' })
  assert.match(await call('shelf_link', { from: b.id, to: a.id, why: '等待的焦虑', evidence: [k2.id, ka.id] }), /2 股/)
  let arcs = memory.arcs()
  assert.equal(arcs.length, 1)
  assert.equal(arcs[0].strands, 2)
  assert.equal(arcs[0].why, '等待的焦虑')
  await core.deleteCard(store, { id: b.id, cardId: k2.id })
  arcs = memory.arcs()
  assert.equal(arcs[0].strands, 1)
  assert.equal(arcs[0].why, '都在等')
})

test('剪断：之前的不显示，AI 不能自己重连，用户要求可以', async () => {
  const { store, memory, call, a, b, ka, kb } = await setup()
  await call('shelf_link', { from: a.id, to: b.id, why: '都在等', evidence: [ka.id, kb.id] })
  assert.match(await call('shelf_unlink', { from: b.id, to: a.id }), /已剪断/)
  assert.equal(memory.arcs().length, 0)
  const k2 = await core.addCard(store, { id: b.id, type: 'thought', note: '再等等' })
  assert.match(await call('shelf_link', { from: a.id, to: b.id, why: '再连', evidence: [ka.id, k2.id] }), /剪断过/)
  // 时间戳到毫秒，等一下保证在剪断之后
  await new Promise(r => setTimeout(r, 5))
  assert.match(await call('shelf_link', { from: a.id, to: b.id, why: '再连', evidence: [ka.id, k2.id], user_asked: true }), /1 股/)
  assert.equal(memory.arcs().length, 1)
  // 手改坏的行跳过
  appendFileSync(join(store.dir, 'links.jsonl'), '{坏行\n')
  assert.equal(memory.arcs().length, 1)
  assert.equal(readFileSync(join(store.dir, 'links.jsonl'), 'utf8').trim().split('\n').length, 4)
})

test('提示：wiki 欠账够多时提示一次；存灵感提示连电弧', async () => {
  const { call, active, a } = await setup()
  active.set('s1', a.id)
  assert.doesNotMatch(await call('shelf_add_card', { type: 'thought', note: '2' }), /提示/)
  assert.match(await call('shelf_add_card', { type: 'thought', note: '3' }), /wiki 之后新增了 3 条/)
  assert.doesNotMatch(await call('shelf_add_card', { type: 'thought', note: '4' }), /提示/)
  const r = await call('shelf_add_inspiration', { title: '等待', body: '…' })
  assert.match(r, /shelf_link/)
  assert.doesNotMatch(r, /wiki 之后/)
  assert.match(await call('shelf_add_card', { type: 'thought', note: '5', item_id: a.id }, 's2'), /wiki 之后新增了 6 条/)
})

test('对话背景：me、索引、当前格子的 wiki 和电弧', async () => {
  const { memory, call, a, b, ka, kb } = await setup()
  await call('shelf_wiki_write', { target: 'me', body: '长期：喜欢侦探小说' })
  await call('shelf_wiki_write', { target: a.id, body: '绿灯 = 等待', summary: '关于等待', topics: ['等待'] })
  await call('shelf_link', { from: a.id, to: b.id, why: '都在等', evidence: [ka.id, kb.id] })
  const text = memory.context({ itemId: a.id })
  assert.match(text, /喜欢侦探小说/)
  assert.match(text, /了不起的盖茨比 id=c_\w+ · 关于等待 · 等待/)
  assert.match(text, /十一月的心情 id=/)
  assert.match(text, /当前格子《了不起的盖茨比》的 wiki\n绿灯 = 等待/)
  assert.match(text, /↔ 十一月的心情（1 股）：都在等/)
  assert.doesNotMatch(memory.context({}), /当前格子/)
  assert.ok(memory.context({ maxChars: 300 }).length <= 300)
})
