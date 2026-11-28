// 演示站数据（#107）：node --import ./test/stubs/register.mjs --test test/demo.test.mjs
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { snapshot } from '../demo/snapshot.ts'

const DATA = new URL('../demo/data/', import.meta.url).pathname

test('demo/data 能读：格子、电弧、聊天记录都对得上', () => {
  const s = snapshot(DATA)
  const ids = new Set(s.palace.cells.map(c => c.id))
  assert.ok(s.palace.cells.length > 0)
  for (const a of s.arcs) for (const id of [a.from, a.to]) assert.ok(ids.has(id), `电弧端点 ${id} 不在宫殿里`)
  for (const c of s.palace.cells) if (c.kind !== 'group') assert.ok(s.items[c.id] !== undefined && s.summaries[c.id] !== undefined)
  // 演示站的欢迎格子会链回演示站自己，不要放进来
  assert.ok(!s.palace.cells.some(c => c.href !== undefined && c.href.includes('dsh-palace.pages.dev')))
})

test('chats.json 写错格子 id 时构建直接失败', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-demo-'))
  cpSync(DATA, dir, { recursive: true })
  writeFileSync(join(dir, 'chats.json'), JSON.stringify({ c_ffffffffff: [{ who: 'user', text: '哪一格？' }] }))
  assert.throws(() => snapshot(dir), /找不到格子/)
})

test('「ⓘ」打开的「关于 Palace」分组还在（demo/src/main.tsx 按 id 找）', () => {
  const g = snapshot(DATA).palace.cells.find(c => c.id === 'c_ffffff0000')
  assert.equal(g?.kind, 'group')
})
