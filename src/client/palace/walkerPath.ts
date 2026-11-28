/** 小人的寻路（#115，移植自设计稿交接包 runtime-reference/walker.js）：矩形障碍 + 角点可视图 + 最短路。纯计算，单测在 test/walker.test.mjs。 */
export interface P { x: number; y: number }
export interface R { left: number; top: number; right: number; bottom: number }

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y)
const inside = (p: P, r: R) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom
const free = (p: P, obs: R[]) => obs.every(r => !inside(p, r))

export function segmentClear(a: P, b: P, obs: R[]): boolean {
  return obs.every((r) => {
    let enter = 0, leave = 1
    for (const [axis, low, high] of [['x', r.left + 0.001, r.right - 0.001], ['y', r.top + 0.001, r.bottom - 0.001]] as const) {
      const d = b[axis] - a[axis]
      if (Math.abs(d) < 1e-9) {
        if (a[axis] < low || a[axis] > high) return true
      } else {
        const t1 = (low - a[axis]) / d, t2 = (high - a[axis]) / d
        enter = Math.max(enter, Math.min(t1, t2))
        leave = Math.min(leave, Math.max(t1, t2))
        if (enter > leave) return true
      }
    }
    return enter > leave
  })
}

const corners = (r: R, pad = 1): P[] => [
  { x: r.left - pad, y: r.top - pad }, { x: r.right + pad, y: r.top - pad },
  { x: r.right + pad, y: r.bottom + pad }, { x: r.left - pad, y: r.bottom + pad },
]

export function nearestFree(want: P, obs: R[]): P | undefined {
  if (free(want, obs)) return want
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  return obs.flatMap(r => [
    ...corners(r, 2),
    { x: r.left - 2, y: clamp(want.y, r.top - 2, r.bottom + 2) },
    { x: r.right + 2, y: clamp(want.y, r.top - 2, r.bottom + 2) },
    { x: clamp(want.x, r.left - 2, r.right + 2), y: r.top - 2 },
    { x: clamp(want.x, r.left - 2, r.right + 2), y: r.bottom + 2 },
  ]).filter(p => free(p, obs)).sort((a, b) => dist(want, a) - dist(want, b))[0]
}

export function planRoute(start: P, goal: P, obs: R[]): P[] | undefined {
  if (!free(start, obs) || !free(goal, obs)) return undefined
  if (segmentClear(start, goal, obs)) return [goal]
  const nodes = [start, goal, ...obs.flatMap(r => corners(r)).filter(p => free(p, obs))]
  const cost = nodes.map(() => Infinity), prev: number[] = [], seen = new Set<number>()
  cost[0] = 0
  while (seen.size < nodes.length) {
    let cur = -1
    for (let i = 0; i < nodes.length; i++) if (!seen.has(i) && (cur < 0 || cost[i] < cost[cur])) cur = i
    if (cur < 0 || !Number.isFinite(cost[cur])) return undefined
    if (cur === 1) {
      const route: P[] = []
      for (let i = 1; i !== 0; i = prev[i]) route.unshift(nodes[i])
      return route
    }
    seen.add(cur)
    for (let i = 1; i < nodes.length; i++) {
      if (seen.has(i)) continue
      const c = cost[cur] + dist(nodes[cur], nodes[i])
      if (c < cost[i] && segmentClear(nodes[cur], nodes[i], obs)) { cost[i] = c; prev[i] = cur }
    }
  }
  return undefined
}

