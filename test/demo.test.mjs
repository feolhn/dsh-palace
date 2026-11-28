// 演示台本（#107）：node --import ./test/stubs/register.mjs --test test/demo.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, durationOf, startState, stateAt } from '../demo/src/script.ts'
import { SCENES, START, START_ISO } from '../demo/src/scenes/index.ts'

test('跳到任意一幕 = 把前面的动作重放一遍；每幕开头清掉字幕和对话', () => {
  const start = startState(START, START_ISO)
  const last = stateAt(start, SCENES, SCENES.length)
  // 逐个动作播完的结果和重放一致（台本里没有随机）
  let s = start
  for (const sc of SCENES) { s = { ...s, caption: undefined, chat: [], panel: undefined }; for (const a of sc.actions) s = apply(s, a) }
  assert.deepEqual(stateAt(start, SCENES, SCENES.length).cells, s.cells)
  assert.equal(last.caption, undefined)
  assert.deepEqual(last.chat, [])
  assert.deepEqual(stateAt(start, SCENES, 0).cells.map(c => c.id), START.map(c => c.id))
})

test('台本自洽：电弧两端的格子都在宫殿里，时长按字数给', () => {
  const start = startState(START, START_ISO)
  let s = start
  for (const sc of SCENES) for (const a of sc.actions) {
    s = apply(s, a)
    if (a.do === 'arc') for (const id of [a.from, a.to]) assert.ok(s.cells.some(c => c.id === id), `电弧端点 ${id} 不在宫殿里`)
  }
  assert.ok(durationOf({ do: 'say', who: 'user', text: '一二三四五六七八九十' }) > durationOf({ do: 'say', who: 'user', text: '一' }))
  assert.equal(durationOf({ do: 'wait', ms: 500 }), 500)
})

test('阅览室和对话面板：读的是书、进出成对；跳到「边读边聊」之后的幕时已经回到宫殿', () => {
  const start = startState(START, START_ISO)
  let s = start
  for (const sc of SCENES) for (const a of sc.actions) {
    if (a.do === 'read') {
      const c = s.cells.find(x => x.id === a.id)
      assert.equal(c?.kind, 'book', `${a.id} 不是书`)
      assert.equal(s.items[a.id].source?.type, 'epub')
    }
    s = apply(s, a)
  }
  assert.equal(s.reading, undefined)
  assert.equal(s.panel, undefined)
  // 打开面板会清空上一段对话
  const opened = apply({ ...start, chat: [{ who: 'user', text: '旧的' }] }, { do: 'chat', open: true, heading: '与宫殿对话' })
  assert.deepEqual([opened.panel, opened.chat], ['与宫殿对话', []])
  // 用户的话含打字时间，比同样长的 AI 回复停得久
  assert.ok(durationOf({ do: 'say', who: 'user', text: '一二三' }) > durationOf({ do: 'say', who: 'ai', text: '一二三' }))
})
