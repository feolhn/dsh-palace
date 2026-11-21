// AI 工具：node --import ./test/stubs/register.mjs --test test/tools.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PalaceStore } from '../src/core/store.ts'
import * as core from '../src/core/ops.ts'
import { createTools } from '../src/host/tools.ts'

function setup() {
  const store = new PalaceStore(mkdtempSync(join(tmpdir(), 'dsh-tools-')))
  const active = new Map()
  const tools = Object.fromEntries(createTools(store, active).map(t => [t.name, t]))
  const call = (name, args, session = 's1') => tools[name].execute(args, { agent: { id: session } })
  return { store, active, call }
}

test('概览、记卡片默认记到当前打开的格子和当前节、存灵感', async () => {
  const { store, active, call } = setup()
  const g = await core.addCell(store, { kind: 'group', title: '2027 法考' })
  const b = await core.addCell(store, { kind: 'book', title: '刑法', parentId: g.id, source: { type: 'pdf', path: '/x.pdf', pageCount: 10 }, outline: [{ title: '一', sections: ['甲', '乙'] }] })
  const item = store.getItem(b.id)
  await core.setSectionDone(store, { id: b.id, sectionId: item.chapters[0].sections[0].id, done: true })

  assert.match(await call('shelf_add_card', { type: 'thought', note: 'x' }), /不知道记到哪个格子/)
  active.set('s1', b.id)
  const overview = await call('shelf_overview', {})
  assert.match(overview, /分组「2027 法考」/)
  assert.match(overview, /书「刑法」.*进度 1\/2 节.*← 用户当前打开的格子/)

  const img = join(tmpdir(), `shot-${Date.now()}.png`)
  writeFileSync(img, 'png')
  assert.match(await call('shelf_add_card', { type: 'mistake', quote: '题目', image: img }), /一 › 乙的错题，原图已保存/)
  const card = store.getItem(b.id).cards[0]
  assert.equal(card.sectionId, item.chapters[0].sections[1].id)
  assert.ok(readdirSync(store.imagesDir).includes(card.image))
  // 同一张截图记两次：各自一份，删一张不影响另一张
  await call('shelf_add_card', { type: 'mistake', quote: '题目 2', image: img })
  assert.notEqual(store.getItem(b.id).cards[1].image, card.image)

  assert.match(await call('shelf_add_inspiration', { title: '刑法的谦抑性', body: '我的想法……' }), /已存到《刑法》的灵感/)
  assert.equal(store.getItem(b.id).inspirations[0].sessionId, 's1')
  assert.match(await call('shelf_overview', { item_id: b.id }), /灵感：\n- .* 刑法的谦抑性/)
})

test('写目录、设目标日期、新建分组和笔记', async () => {
  const { store, call } = setup()
  assert.match(await call('shelf_add', { kind: 'group', title: 'G' }), /已新建分组「G」/)
  const g = store.getPalace().cells[0]
  assert.match(await call('shelf_add', { kind: 'note', title: '心情', parent_id: g.id }), /已新建笔记「心情」/)
  assert.match(await call('shelf_add', { kind: 'book', path: '/nope.pdf' }), /操作失败：找不到文件/)
  const b = await core.addCell(store, { kind: 'book', title: 'B', source: { type: 'pdf', path: '/x.pdf', pageCount: 10 } })
  assert.match(await call('shelf_set_outline', { item_id: b.id, chapters: [{ title: '第一章', sections: [{ title: '一', page: 3 }] }] }), /1 章 1 节/)
  assert.equal(store.getItem(b.id).chapters[0].sections[0].loc, '3')
  assert.match(await call('shelf_set_target_dates', { items: [{ item_id: b.id, target_date: '2099-01-01' }] }), /《B》→ 2099-01-01/)
})

test('删除格子：书连同卡片一起删，非空分组不能删', async () => {
  const { store, call } = setup()
  const g = await core.addCell(store, { kind: 'group', title: 'G' })
  const b = await core.addCell(store, { kind: 'note', title: '心情', parentId: g.id })
  await core.addCard(store, { id: b.id, type: 'thought', note: 'x' })
  assert.match(await call('shelf_remove', { item_id: g.id }), /分组里还有格子/)
  assert.match(await call('shelf_remove', { item_id: b.id }), /已删除笔记「心情」（卡片 1 张、灵感 0 条）/)
  // 删掉最后一格，分组自动消失
  assert.equal(store.getPalace().cells.length, 0)
  assert.match(await call('shelf_remove', { item_id: 'nope' }), /格子不存在/)
})
