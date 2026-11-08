// 后端冒烟测试：node --experimental-strip-types --no-warnings test/host-smoke.mjs <pdf> [bilibili-url]
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShelfStore } from '../src/host/store.ts'
import * as ops from '../src/host/ops.ts'
import { createRoutes } from '../src/host/routes.ts'
import { progressOf, paceOf } from '../src/shared/model.ts'

const [pdf, video] = process.argv.slice(2)
const dir = mkdtempSync(join(tmpdir(), 'dsh-shelf-test-'))
const store = new ShelfStore(dir)
const goal = await ops.addGoal(store, { name: '2027 法考', examDate: '2027-09-15' })
const subject = await ops.addSubject(store, { goalId: goal.id, name: '刑法' })
const book = await ops.addBook(store, { subjectId: subject.id, file: pdf, targetDate: '2026-12-31' })
console.log('book', book.title, book.pageCount, 'chapters', book.chapters.length)

// 目录 + 进度
const m = await ops.setOutline(store, { id: book.id, chapters: [
  { title: '第一讲 刑法论', sections: ['刑法的解释', { title: '刑法的效力', page: 12 }] },
  { title: '第二讲 犯罪论体系' },
] })
assert.equal(progressOf(m).total, 3)
const [s1, s2] = m.chapters[0].sections
await ops.markUpTo(store, { materialId: m.id, sectionId: s2.id })
let lib = store.get()
assert.equal(progressOf(lib.materials[0]).done, 2)
console.log('pace', paceOf(lib.materials[0]))
// 重新生成目录：同名节保留完成状态
const m2 = await ops.setOutline(store, { id: book.id, chapters: [
  { title: '第一讲 刑法论', sections: ['刑法的解释', '刑法的效力', '刑法的原则'] },
] })
assert.equal(progressOf(m2).done, 2, '重新生成目录后保留进度')

// 错题：默认挂到当前节；用附件 id 找原图
const objects = join(process.env.HOME, '.dsh/attachments/v1/objects')
const sub = readdirSync(objects)[0]
const digest = readdirSync(join(objects, sub))[0]
const added = await ops.addMistake(store, { materialId: book.id, question: '关于不作为犯罪……', image: `sha256:${digest.slice(0, 16)}` })
console.log('mistake section', added.mistake.sectionId === progressOf(m2).current.section.id, 'image', added.imageSaved, added.mistake.image)
await assert.rejects(ops.addBook(store, { subjectId: subject.id, file: '/nope.pdf' }), ops.ShelfError)

// 路由
const routes = Object.fromEntries(createRoutes(store, new Map()).map(r => [r.path.split('/').pop(), r]))
const call = (name, url = '', init) => routes[name].fetch(new Request(`http://x/api/dsh-shelf/${name}${url}`, init))
let r = await call('library'); console.log('GET library', r.status, (await r.json()).library.materials.length)
r = await call('op', '', { method: 'POST', body: JSON.stringify({ op: 'setSectionDone', args: { materialId: book.id, sectionId: m2.chapters[0].sections[2].id, done: true } }) })
console.log('POST op', r.status, await r.json())
r = await call('op', '', { method: 'POST', body: JSON.stringify({ op: 'addGoal', args: { name: '' } }) }); console.log('POST bad op', r.status, (await r.json()).error)
r = await call('op', '', { method: 'POST', body: JSON.stringify({ op: 'hack', args: {} }) }); console.log('POST unknown op', r.status)
r = await call('pdf', `?id=${book.id}`); console.log('GET pdf', r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength)
r = await call('page-text', `?id=${book.id}&pages=7,8`); const pt = await r.json(); console.log('GET page-text', r.status, pt.pages.map(p => p.text.length), 'scanned', pt.scanned)
r = await call('asset', '?f=cmaps/UniGB-UCS2-H.bcmap'); console.log('GET asset', r.status, (await r.arrayBuffer()).byteLength)
r = await call('asset', '?f=../package.json'); console.log('GET asset traversal', r.status)
r = await call('image', `?name=${added.mistake.image}`); console.log('GET image', r.status, r.headers.get('content-type'))
r = await call('image', `?name=../library.json`); console.log('GET image traversal', r.status)

if (video) {
  const v = await ops.addVideo(store, { subjectId: subject.id, url: video })
  console.log('video', v.title, 'chapters', v.chapters.length, 'episodes', progressOf(v).total, v.chapters[0].sections.slice(0, 2))
}
console.log('data dir', dir)
