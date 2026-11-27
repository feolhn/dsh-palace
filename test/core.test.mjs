// v0.2 存储与业务操作测试：node --test test/core.test.mjs
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PalaceStore } from '../src/core/store.ts'
import * as ops from '../src/core/ops.ts'
import { paceOf, progressOf } from '../src/shared/palace.ts'

const fresh = () => new PalaceStore(mkdtempSync(join(tmpdir(), 'dsh-palace-')))
const pdf = { type: 'pdf', path: '/tmp/a.pdf', pageCount: 100 }
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
/** 模拟用户手改文件：把修改时间推后，保证和上次写入不同。 */
function handEdit(file, data) {
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data))
  const t = new Date(Date.now() + 5000)
  utimesSync(file, t, t)
}

test('新建格子：自动找空位、分组只能在最外层、书和笔记有内容文件', async () => {
  const store = fresh()
  const g = await ops.addCell(store, { kind: 'group', title: '2027 法考' })
  const b1 = await ops.addCell(store, { kind: 'book', title: '刑法', parentId: g.id, source: pdf })
  const b2 = await ops.addCell(store, { kind: 'book', title: '民法', parentId: g.id, source: pdf })
  const n = await ops.addCell(store, { kind: 'note', title: '心情' })
  assert.deepEqual([g.col, g.row, n.col, n.row], [0, 0, 1, 0])
  assert.deepEqual([b1.col, b1.row, b2.col, b2.row], [0, 0, 1, 0])
  assert.ok(existsSync(join(store.itemsDir, `${b1.id}.json`)))
  assert.ok(!existsSync(join(store.itemsDir, `${g.id}.json`)))
  await assert.rejects(ops.addCell(store, { kind: 'group', title: '套娃', parentId: g.id }), /分组里不能再放分组/)
  await assert.rejects(ops.addCell(store, { kind: 'note', title: 'x', parentId: n.id }), /只能放进分组里/)
  await assert.rejects(ops.addCell(store, { kind: 'note', title: 'x', parentId: g.id, col: -1, row: 0 }), /不能为负/)
  await assert.rejects(ops.addCell(store, { kind: 'note', title: 'x', col: 0, row: 0 }), /已经有格子/)
  await assert.rejects(ops.addCell(store, { kind: 'book', title: 'x' }), /原文信息无效/)
})

test('移动：空位直接移，有格子就互换（可以跨层）；分组不能换进分组', async () => {
  const store = fresh()
  const g = await ops.addCell(store, { kind: 'group', title: 'G' })
  const a = await ops.addCell(store, { kind: 'note', title: 'A' })              // 外层 (1,0)
  const b = await ops.addCell(store, { kind: 'note', title: 'B', parentId: g.id }) // 组内 (0,0)
  await ops.moveCell(store, { id: a.id, col: -3, row: -2 })
  let cells = store.getPalace().cells
  assert.deepEqual(cells.find(c => c.id === a.id), { ...a, col: -3, row: -2 })
  // A 换到 B 的位置：B 去 A 原来的位置（外层）
  await ops.moveCell(store, { id: a.id, parentId: g.id, col: 0, row: 0 })
  cells = store.getPalace().cells
  const A = cells.find(c => c.id === a.id), B = cells.find(c => c.id === b.id)
  assert.deepEqual([A.parentId, A.col, A.row], [g.id, 0, 0])
  assert.deepEqual([B.parentId, B.col, B.row], [null, -3, -2])
  // 组内的 A 想换到外层分组 G 的位置：G 会被换进分组，不允许
  await assert.rejects(ops.moveCell(store, { id: a.id, col: g.col, row: g.row }), /分组不能换进另一个分组/)
  await assert.rejects(ops.moveCell(store, { id: g.id, parentId: g.id, col: 1, row: 1 }), /分组里不能再放分组/)
  // 坐标唯一
  const keys = store.getPalace().cells.map(c => `${c.parentId}:${c.col}:${c.row}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('拖成组：在被拖到的格子位置新建分组，两格放进去；分组不参与', async () => {
  const store = fresh()
  const a = await ops.addCell(store, { kind: 'note', title: 'A' })
  const b = await ops.addCell(store, { kind: 'note', title: 'B' })
  const where = { col: b.col, row: b.row }
  const g = await ops.groupCells(store, { id: a.id, ontoId: b.id })
  const cells = store.getPalace().cells
  assert.deepEqual([g.kind, g.parentId, g.col, g.row, g.title], ['group', null, where.col, where.row, '新分组'])
  const B = cells.find(c => c.id === b.id), A = cells.find(c => c.id === a.id)
  assert.deepEqual([B.parentId, B.col, B.row], [g.id, 0, 0])
  assert.deepEqual([A.parentId, A.col, A.row], [g.id, 1, 0])
  await assert.rejects(ops.groupCells(store, { id: a.id, ontoId: g.id }), /分组不能再放进分组/)
  await assert.rejects(ops.groupCells(store, { id: a.id, ontoId: b.id }), /只能在最外层/)
  const keys = store.getPalace().cells.map(c => `${c.parentId}:${c.col}:${c.row}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('分组的最后一格移出或删掉后，分组自动消失；新建的空分组保留', async () => {
  const store = fresh()
  const empty = await ops.addCell(store, { kind: 'group', title: 'E' })
  const g = await ops.addCell(store, { kind: 'group', title: 'G' })
  const a = await ops.addCell(store, { kind: 'note', title: 'A', parentId: g.id })
  const b = await ops.addCell(store, { kind: 'note', title: 'B', parentId: g.id })
  await ops.moveCell(store, { id: a.id, col: 9, row: 9 })
  assert.ok(store.getPalace().cells.some(c => c.id === g.id))
  await ops.deleteCell(store, { id: b.id })
  const ids = store.getPalace().cells.map(c => c.id)
  assert.ok(!ids.includes(g.id))
  assert.ok(ids.includes(empty.id) && ids.includes(a.id))
  // 组里唯一一格拖出来和外层的格子组成新分组：原分组消失
  const h = await ops.addCell(store, { kind: 'group', title: 'H' })
  const c = await ops.addCell(store, { kind: 'note', title: 'C', parentId: h.id })
  const n = await ops.groupCells(store, { id: c.id, ontoId: a.id })
  const after = store.getPalace().cells
  assert.ok(!after.some(x => x.id === h.id))
  assert.equal(after.filter(x => x.parentId === n.id).length, 2)
})

test('删除：非空分组不能删；书连同内容文件和卡片原图一起删', async () => {
  const store = fresh()
  const g = await ops.addCell(store, { kind: 'group', title: 'G' })
  const b = await ops.addCell(store, { kind: 'book', title: 'B', parentId: g.id, source: pdf })
  writeFileSync(join(store.imagesDir, 'k_1.png'), 'x')
  await ops.addCard(store, { id: b.id, type: 'mistake', quote: '题目', image: 'k_1.png' })
  await assert.rejects(ops.deleteCell(store, { id: g.id }), /还有格子/)
  await ops.deleteCell(store, { id: b.id })
  assert.ok(!existsSync(join(store.itemsDir, `${b.id}.json`)))
  assert.ok(!existsSync(join(store.imagesDir, 'k_1.png')))
  // 删掉最后一格，分组自动消失
  assert.equal(store.getPalace().cells.length, 0)
  const empty = await ops.addCell(store, { kind: 'group', title: 'E' })
  await ops.deleteCell(store, { id: empty.id })
  assert.equal(store.getPalace().cells.length, 0)
})

test('进度：目录、学到这里、节奏；重新生成目录保留完成状态，卡片挂回同名节', async () => {
  const store = fresh()
  const b = await ops.addCell(store, { kind: 'book', title: 'B', source: pdf, targetDate: '2026-12-31' })
  let item = await ops.setOutline(store, { id: b.id, source: 'ai', chapters: [
    { title: '第一讲', sections: ['解释', { title: '效力', loc: '12' }] },
    { title: '第二讲' },
  ] })
  assert.equal(progressOf(item).total, 3)
  assert.equal(item.chapters[0].sections[1].loc, '12')
  const [s1, s2] = item.chapters[0].sections
  await ops.markUpTo(store, { id: b.id, sectionId: s2.id })
  assert.equal(progressOf(store.getItem(b.id)).done, 2)
  assert.equal(paceOf(store.getItem(b.id), '2026-12-31').perDay, 1)
  const c1 = await ops.addCard(store, { id: b.id, type: 'excerpt', quote: '原文', sectionId: s1.id })
  const c2 = await ops.addCard(store, { id: b.id, type: 'thought', note: '想法', sectionId: s2.id })

  item = await ops.setOutline(store, { id: b.id, chapters: [{ title: '第一讲', sections: ['解释', '新的一节'] }] })
  const [n1, n2] = item.chapters[0].sections
  assert.equal(n1.done, true)
  assert.equal(n2.done, false)
  assert.equal(item.cards.find(k => k.id === c1.id).sectionId, n1.id)
  assert.equal(item.cards.find(k => k.id === c2.id).sectionId, undefined)
  await ops.resetProgress(store, { id: b.id })
  assert.equal(progressOf(store.getItem(b.id)).done, 0)
  assert.equal(store.summaries()[b.id].total, 2)
})

test('卡片和灵感：校验、修改、删除卡片时灵感里的引用也去掉', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  await assert.rejects(ops.addCard(store, { id: n.id, type: 'excerpt' }), /需要原文或图片/)
  await assert.rejects(ops.addCard(store, { id: n.id, type: 'thought', note: 'x', image: '../evil' }), /图片文件名无效/)
  const k = await ops.addCard(store, { id: n.id, type: 'mistake', quote: '题' })
  assert.equal(k.status, 'todo')
  await ops.updateCard(store, { id: n.id, cardId: k.id, status: 'mastered', share: { color: '#efe8d2' }, answer: '答案' })
  const saved = store.getItem(n.id).cards[0]
  assert.deepEqual([saved.status, saved.answer, saved.share.color], ['mastered', '答案', '#efe8d2'])
  await assert.rejects(ops.updateCard(store, { id: n.id, cardId: k.id, share: 'x' }), /分享草稿格式不对/)
  await assert.rejects(ops.updateCard(store, { id: n.id, cardId: k.id, share: { s: 'x'.repeat(70000) } }), /分享草稿太大/)
  await ops.updateCard(store, { id: n.id, cardId: k.id, answer: null })
  assert.equal(store.getItem(n.id).cards[0].answer, undefined)
  const i = await ops.addInspiration(store, { id: n.id, title: 'T', body: '正文', cardIds: [k.id, 'k_不存在'] })
  assert.deepEqual(i.cardIds, [k.id])
  await ops.deleteCard(store, { id: n.id, cardId: k.id })
  assert.equal(store.getItem(n.id).inspirations[0].cardIds.length, 0)
  await ops.deleteInspiration(store, { id: n.id, inspirationId: i.id })
  assert.equal(store.getItem(n.id).inspirations.length, 0)
})

test('认不出的字段原样保留', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  const pf = join(store.dir, 'palace.json'), itf = join(store.itemsDir, `${n.id}.json`)
  const p = readJson(pf); p.future = 1; p.cells[0].color = 'blue'; handEdit(pf, p)
  const it = readJson(itf); it.mood = 'happy'; handEdit(itf, it)
  await ops.updateCell(store, { id: n.id, title: 'N2' })
  await ops.addCard(store, { id: n.id, type: 'thought', note: 'x' })
  assert.deepEqual([readJson(pf).future, readJson(pf).cells[0].color, readJson(pf).cells[0].title], [1, 'blue', 'N2'])
  assert.equal(readJson(itf).mood, 'happy')
})

test('手改文件：改对了会重新读；改坏了继续用内存版本，并拒绝写入、不覆盖用户的文件', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  const pf = join(store.dir, 'palace.json')
  const p = readJson(pf); p.cells[0].title = '手改'; handEdit(pf, p)
  assert.equal(store.getPalace().cells[0].title, '手改')
  handEdit(pf, '{ 坏了')
  assert.equal(store.getPalace().cells[0].title, '手改')
  await assert.rejects(ops.addCell(store, { kind: 'note', title: 'x' }), /palace.json 格式有误/)
  assert.equal(readFileSync(pf, 'utf8'), '{ 坏了')
  const itf = join(store.itemsDir, `${n.id}.json`)
  handEdit(pf, p)
  await assert.rejects(ops.updateItem(store, { id: '../x' }), /id 无效/)
  handEdit(itf, '[坏')
  await assert.rejects(ops.addCard(store, { id: n.id, type: 'thought', note: 'x' }), /格式有误/)
  assert.equal(readFileSync(itf, 'utf8'), '[坏')
})

test('并发修改串行执行，不丢数据；出错的修改不落盘', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  await Promise.all(Array.from({ length: 20 }, (_, i) => ops.addCard(store, { id: n.id, type: 'thought', note: `第 ${i} 条` })))
  assert.equal(store.getItem(n.id).cards.length, 20)
  const before = readFileSync(join(store.dir, 'palace.json'), 'utf8')
  await assert.rejects(ops.moveCell(store, { id: n.id, col: 1.5, row: 0 }), /整数/)
  assert.equal(readFileSync(join(store.dir, 'palace.json'), 'utf8'), before)
  // 重新打开同一个目录，数据都在
  const again = new PalaceStore(store.dir)
  assert.equal(again.getItem(n.id).cards.length, 20)
})

// ---------- #26 审查发现的问题（回归测试） ----------

test('审查 1：JSON 合法但字段类型错了，当作改坏，拒绝写入', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  await ops.addCard(store, { id: n.id, type: 'thought', note: '原卡片' })
  const itf = join(store.itemsDir, `${n.id}.json`)
  const it = readJson(itf); it.cards = it.cards[0]; handEdit(itf, it)
  const before = readFileSync(itf, 'utf8')
  await assert.rejects(ops.updateItem(store, { id: n.id, targetDate: '2026-12-31' }), /格式有误/)
  assert.equal(readFileSync(itf, 'utf8'), before)
})

test('审查 2：mutate 的回调必须是同步的', async () => {
  const store = fresh()
  await assert.rejects(store.mutate(async () => 1), /必须是同步的/)
})

test('审查 3：删掉改坏的文件就能恢复；删掉正常的 item 文件后按空内容读', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  await ops.addCard(store, { id: n.id, type: 'thought', note: 'x' })
  const pf = join(store.dir, 'palace.json'), itf = join(store.itemsDir, `${n.id}.json`)
  const good = readJson(pf)
  handEdit(pf, '{ 坏了'); store.getPalace()
  rmSync(pf)
  await ops.addCell(store, { kind: 'note', title: '删掉后重新开始' })
  assert.equal(store.getPalace().cells.length, 1)
  handEdit(pf, good)
  handEdit(itf, '[坏'); store.getItem(n.id)
  rmSync(itf)
  assert.equal(store.getItem(n.id).cards.length, 0)
  await ops.addCard(store, { id: n.id, type: 'thought', note: 'y' })
  assert.equal(readJson(itf).cards.length, 1)
})

test('审查 4：提交后的清理失败不影响结果，rev 照常增加', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  writeFileSync(join(store.imagesDir, 'k_1.png'), 'x')
  const k = await ops.addCard(store, { id: n.id, type: 'excerpt', image: 'k_1.png' })
  chmodSync(store.imagesDir, 0o555)
  try {
    const rev = store.rev
    await ops.deleteCard(store, { id: n.id, cardId: k.id })
    assert.equal(store.getItem(n.id).cards.length, 0)
    assert.ok(store.rev > rev)
  } finally {
    chmodSync(store.imagesDir, 0o755)
  }
})

test('审查 5：一张图片只能属于一张卡片', async () => {
  const store = fresh()
  const a = await ops.addCell(store, { kind: 'note', title: 'A' })
  const b = await ops.addCell(store, { kind: 'note', title: 'B' })
  await ops.addCard(store, { id: a.id, type: 'excerpt', image: 'k_1.png' })
  await assert.rejects(ops.addCard(store, { id: b.id, type: 'excerpt', image: 'k_1.png' }), /另一张卡片/)
  const k = await ops.addCard(store, { id: b.id, type: 'excerpt', quote: 'q' })
  await assert.rejects(ops.updateCard(store, { id: b.id, cardId: k.id, image: 'k_1.png' }), /另一张卡片/)
})

test('审查 6：标题全是空白的目录不会清空原目录', async () => {
  const store = fresh()
  const b = await ops.addCell(store, { kind: 'book', title: 'B', source: pdf })
  await ops.setOutline(store, { id: b.id, chapters: [{ title: '第一讲' }] })
  await assert.rejects(ops.setOutline(store, { id: b.id, chapters: [{ title: '   ' }] }), /目录不能为空/)
  assert.equal(store.getItem(b.id).chapters.length, 1)
})

test('审查 7：修改后也不能变成空卡片', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  const t = await ops.addCard(store, { id: n.id, type: 'thought', note: '内容' })
  const e = await ops.addCard(store, { id: n.id, type: 'excerpt', quote: '原文' })
  await assert.rejects(ops.updateCard(store, { id: n.id, cardId: t.id, note: null }), /想法不能为空/)
  await assert.rejects(ops.updateCard(store, { id: n.id, cardId: e.id, quote: '' }), /需要原文或图片/)
  assert.equal(store.getItem(n.id).cards[0].note, '内容')
})

test('复核 1：读取之后文件被外部改过，拒绝提交，不覆盖', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  const itf = join(store.itemsDir, `${n.id}.json`)
  await assert.rejects(store.mutate((tx) => {
    tx.item(n.id).targetDate = '2026-12-31'
    const it = readJson(itf); it.cards.push({ id: 'k_ext', type: 'thought', note: '外部', createdAt: 'x' }); handEdit(itf, it)
  }), /被其他程序修改过/)
  assert.equal(readJson(itf).cards[0].id, 'k_ext')
})

test('复核 2：节数据损坏当作改坏，沿用上一次的好版本', async () => {
  const store = fresh()
  const b = await ops.addCell(store, { kind: 'book', title: 'B', source: pdf })
  await ops.setOutline(store, { id: b.id, chapters: [{ title: '第一讲' }] })
  const itf = join(store.itemsDir, `${b.id}.json`)
  const it = readJson(itf); it.chapters[0].sections = [null]; handEdit(itf, it)
  assert.equal(store.summaries()[b.id].total, 1)
})

test('新建书时带初始目录；不给坐标的移动放到目标层第一个空位', async () => {
  const store = fresh()
  const g = await ops.addCell(store, { kind: 'group', title: 'G' })
  const b = await ops.addCell(store, { kind: 'book', title: 'B', source: pdf, outline: [{ title: '第一章', sections: ['一', '二'] }], outlineSource: 'bookmarks' })
  assert.equal(progressOf(store.getItem(b.id)).total, 2)
  assert.equal(store.getItem(b.id).outlineSource, 'bookmarks')
  await ops.addCell(store, { kind: 'note', title: 'x', parentId: g.id })
  const moved = await ops.moveCell(store, { id: b.id, parentId: g.id })
  assert.deepEqual([moved.parentId, moved.col, moved.row], [g.id, 1, 0])
})

test('阅读起止月份：从打勾、卡片、灵感推出，读完才有结束（Discussion #37）', async () => {
  const { summaryOf, emptyItem } = await import('../src/shared/palace.ts')
  const item = emptyItem('c_0000000001')
  assert.equal(summaryOf(item).period, undefined)
  item.cards.push({ id: 'k_1', type: 'thought', note: 'x', createdAt: '2026-11-03T04:00:00.000Z' })
  item.chapters.push({ id: 'ch', title: '一', sections: [{ id: 's', title: '甲', done: true, doneAt: '2026-10-20T04:00:00.000Z' }] })
  assert.deepEqual(summaryOf(item).period, { start: '2026-10' })
  item.finishedAt = '2026-12-01'
  assert.deepEqual(summaryOf(item).period, { start: '2026-10', end: '2026-12' })
})

test('图标名可以带数字（gta6），不能有大写或别的符号', async () => {
  const store = fresh()
  const n = await ops.addCell(store, { kind: 'note', title: 'N' })
  assert.equal((await ops.updateCell(store, { id: n.id, icon: 'gta6' })).icon, 'gta6')
  await assert.rejects(ops.updateCell(store, { id: n.id, icon: 'GTA6' }), /图标名无效/)
  await assert.rejects(ops.updateCell(store, { id: n.id, icon: '../x' }), /图标名无效/)
})
