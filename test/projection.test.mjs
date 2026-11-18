// 轴测投影（#42）：node --import ./test/stubs/register.mjs --test test/projection.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { delta, matrixOf, project, spreadDrop, spreadLayout, unproject } from '../src/client/palace/projection.ts'

const cell = (id, kind, col, row, parentId = null) => ({ id, kind, col, row, parentId, title: id, createdAt: '' })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`)

test('amount=0 是原样；投影和反投影互逆', () => {
  const flat = matrixOf(0)
  assert.deepEqual(project(flat, 10, 20, 100, 100), { x: 10, y: 20 })
  const m = matrixOf(1)
  const p = project(m, 30, 70, 800, 600), u = unproject(m, p.x, p.y, 800, 600)
  close(u.x, 30); close(u.y, 70)
  const d = delta(m, m.a * 5 + m.c * 7, m.b * 5 + m.d * 7)
  close(d.x, 5); close(d.y, 7)
})

test('分组原地展开，撞到的最外层格子往右挪', () => {
  const cells = [
    cell('g', 'group', 0, 0), cell('a', 'book', 0, 0, 'g'), cell('b', 'book', 1, 0, 'g'), cell('c', 'note', 0, 1, 'g'),
    cell('x', 'book', 1, 0),
  ]
  const L = spreadLayout(cells)
  const g = L.frames.get('g')
  // 组头 + 3 格 → 2×2
  assert.deepEqual([g.col, g.row, g.w, g.h], [0, 0, 2, 2])
  assert.deepEqual([L.entries.get('a').col, L.entries.get('a').row], [1, 0])
  assert.deepEqual(L.entries.get('a').origin, { col: 0, row: 0 })
  // x 原本在 (1,0)，被分组区域挡住 → 挪到 (2,0)
  assert.deepEqual([L.entries.get('x').col, L.entries.get('x').row], [2, 0])

  // 落在格子上 = 那个格子的真实位置；落在分组区域空处 = 放进分组（真实位置被占就往右找）；空处 = 最外层
  assert.deepEqual(spreadDrop(L, cells, { col: 2, row: 0 }), { parentId: null, col: 1, row: 0 })
  assert.deepEqual(spreadDrop(L, cells, { col: 0, row: 0 }), { parentId: null, col: 0, row: 0 })
  assert.deepEqual(spreadDrop(L, cells, { col: 1, row: 1 }), { parentId: 'g', col: 0, row: 1 })
  assert.deepEqual(spreadDrop(L, cells, { col: 5, row: 5 }), { parentId: null, col: 5, row: 5 })
})

test('落在分组区域的空位：放进分组，真实位置被占就往右找', () => {
  const cells = [cell('h', 'group', 0, 0), ...[0, 1, 2, 3].map(i => cell(`k${i}`, 'book', i, 0, 'h')), cell('k4', 'book', 2, 1, 'h')]
  // 组头 + 5 格 → 3 列 2 行，正好占满；再少一格才有空位
  const L = spreadLayout(cells.slice(0, 5))
  assert.deepEqual([L.frames.get('h').w, L.frames.get('h').h], [3, 2])
  // 显示的空位是组内 (2,1)，真实位置 (2,1) 被 k4 占着 → (3,1)
  assert.deepEqual(spreadDrop(L, cells, { col: 2, row: 1 }), { parentId: 'h', col: 3, row: 1 })
})
