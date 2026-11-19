// AI 光球（#29）：node --import ./test/stubs/register.mjs --test test/orb.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { candidates, collideCursor, emptyCell, readerArea, step } from '../src/client/palace/orb.ts'

const view = { width: 1200, height: 800, x: 0, y: 0, spacing: 268, occupied: [{ col: 0, row: 0 }], exclusions: [] }

test('只放在完整、空着的格子里；偏向三个边角', () => {
  assert.equal(emptyCell(view, 0, 0), undefined) // 有东西
  assert.equal(emptyCell(view, 4, 0), undefined) // 出了屏幕
  assert.ok(emptyCell(view, 1, 1))
  const pools = candidates(view)
  assert.ok(pools.length >= 2)
  for (const pool of pools) for (const c of pool) assert.ok(!(c.col === 0 && c.row === 0))
})

test('碰边反弹；鼠标撞上会把球推开', () => {
  const bounds = { w: 268, h: 268, radius: 39 }
  const ball = { x: 260, y: 100, vx: 50, vy: 0, sx: 1, sy: 1 }
  step(ball, bounds, 0.016)
  assert.ok(ball.vx < 0 && ball.x <= 268 - 39)
  const b2 = { x: 100, y: 100, vx: 0, vy: 0, sx: 1, sy: 1 }
  assert.ok(collideCursor(b2, bounds, { x: 90, y: 100, vx: 300, vy: 0 }, 40))
  assert.ok(b2.vx > 0)
})

test('阅读时待在书右上方斜对角那一格', () => {
  const area = readerArea({ ...view, readerRect: { x: 40, y: 300, w: 800, h: 450 } })
  assert.deepEqual(area, { x: 843, y: 35, w: 262, h: 262 })
  assert.equal(readerArea({ ...view, readerRect: { x: 40, y: 10, w: 800, h: 450 } }), undefined) // 上面没地方
})
