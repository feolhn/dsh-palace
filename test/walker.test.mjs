// 小人寻路（#115）：node --import ./test/stubs/register.mjs --test test/walker.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nearestFree, planRoute, segmentClear } from '../src/client/palace/walkerPath.ts'

const box = { left: 0, top: 0, right: 100, bottom: 100 }

test('直线被挡住时绕开障碍，路线每一段都不穿过障碍', () => {
  const start = { x: -50, y: 50 }, goal = { x: 150, y: 50 }
  assert.equal(segmentClear(start, goal, [box]), false)
  const route = planRoute(start, goal, [box])
  assert.ok(route !== undefined && route.length > 1)
  let at = start
  for (const p of route) { assert.ok(segmentClear(at, p, [box])); at = p }
  assert.deepEqual(at, goal)
})

test('站在障碍里或无路可走就不走；障碍里的点能挪到最近的安全点', () => {
  assert.equal(planRoute({ x: 50, y: 50 }, { x: 200, y: 0 }, [box]), undefined)
  const safe = nearestFree({ x: 50, y: 95 }, [box])
  assert.deepEqual(safe, { x: 50, y: 102 })
  // 被四面围住：没有路
  const walls = [{ left: -60, top: -60, right: 60, bottom: -40 }, { left: -60, top: 40, right: 60, bottom: 60 }, { left: -60, top: -60, right: -40, bottom: 60 }, { left: 40, top: -60, right: 60, bottom: 60 }]
  assert.equal(planRoute({ x: 0, y: 0 }, { x: 200, y: 200 }, walls), undefined)
})
