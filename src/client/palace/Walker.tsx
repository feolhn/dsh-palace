/**
 * 立体视图里的像素小人（实验功能，#115；规则照设计稿交接包 WALKER.md，寻路移植自参考实现 walker.js）。
 * - 鼠标停在图标上：小人走到图标旁边的安全位置；途中换目标就从当前位置重新寻路。移开鼠标继续走完。
 * - 点小人（或 Enter / Space）换角色，脚底位置、朝向、路线都不变。
 * - 避障用图标真实可见的范围（图片 alpha 边界），按人物全身边界扩张，留 6px；用扩张矩形的角点求最短路，无路就停。
 * 坐标：位置和速度在地面（世界坐标），寻路在「缩放为 1 的投影画面」里做：v = M·world，与镜头平移、缩放无关。
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { project, type Matrix } from './projection.ts'
import { fileUrl } from './theme.ts'
import { nearestFree, planRoute, type P, type R } from './walkerPath.ts'

interface Obstacle extends R { id: string; raw: R }
type Dir = 'south' | 'east' | 'north' | 'west'

// #110 交接包的原始雪碧图：64×64 一帧，5 帧 × 4 朝向，按原型显示为 116px 一帧。
const FRAME = 116
const ZOOM = FRAME / 64
const ANCHOR = { x: 32 * ZOOM, y: 60 * ZOOM }
// 两套角色全部帧的联合边界 [14, 10, 50, 60)，换算成相对脚底的显示坐标。
const BODY = {
  left: 14 * ZOOM - ANCHOR.x, right: 50 * ZOOM - ANCHOR.x,
  top: 10 * ZOOM - ANCHOR.y, bottom: 60 * ZOOM - ANCHOR.y,
}
const GAP = 6
const SPEED = 190
const DIRS: Dir[] = ['south', 'east', 'north', 'west']
const CHARACTERS = [{ id: 'dipper', name: 'Dipper' }, { id: 'mabel', name: 'Mabel' }]

// ---------- 图标的可见范围（alpha 边界，按图片地址缓存） ----------

const alphaCache = new Map<string, R | null>()
function alphaBounds(img: HTMLImageElement, onReady: () => void): R | null {
  const key = img.currentSrc || img.src
  if (alphaCache.has(key)) return alphaCache.get(key)!
  if (!img.complete || img.naturalWidth === 0) { img.addEventListener('load', onReady, { once: true }); return null }
  let out: R | null = null
  try {
    const w = img.naturalWidth, h = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, w, h).data
    let l = w, t = h, r = -1, b = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y) }
    }
    if (r >= 0) out = { left: l / w, top: t / h, right: (r + 1) / w, bottom: (b + 1) / h }
  } catch { /* 读不了像素就按整张图算 */ }
  alphaCache.set(key, out)
  return out
}

// ---------- 组件 ----------

export function Walker({ rootRef, enabled, paused, m, cam, size, layoutKey }: {
  rootRef: RefObject<HTMLDivElement>
  /** 像素皮肤、立体首页、过渡结束、没在拖动 / 分组 / 阅览室 */
  enabled: boolean
  /** 地图手势、对话框期间：停在原地 */
  paused: boolean
  m: Matrix
  cam: { x: number; y: number; scale: number }
  size: { w: number; h: number }
  /** 格子布局变了（位置、数量）就重新量障碍 */
  layoutKey: string
}) {
  const layer = useRef<HTMLDivElement>(null)
  const sprite = useRef<HTMLButtonElement>(null)
  const [character, setCharacter] = useState(0)
  const [measured, setMeasured] = useState(0)
  const s = useRef({
    pos: undefined as P | undefined, // 世界坐标
    target: undefined as string | undefined,
    route: undefined as P[] | undefined, // 世界坐标
    dirty: true,
    dir: 'south' as Dir,
    walked: 0,
    obstacles: [] as Obstacle[],
    raf: 0,
    last: 0,
  })
  const live = useRef({ enabled, paused, m, cam, size })
  live.current = { enabled, paused, m, cam, size }

  const view = (p: P): P => ({ x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y })
  const world = (p: P): P => { const det = m.a * m.d - m.b * m.c; return { x: (m.d * p.x - m.c * p.y) / det, y: (m.a * p.y - m.b * p.x) / det } }
  const viewRef = useRef({ view, world })
  viewRef.current = { view, world }

  const draw = (frame: number) => {
    const el = layer.current, st = s.current, { m, cam, size } = live.current
    if (el === null || st.pos === undefined) return
    const p = project(m, cam.x + st.pos.x * cam.scale, cam.y + st.pos.y * cam.scale, size.w, size.h)
    el.style.transform = `translate(${p.x}px,${p.y}px) scale(${cam.scale})`
    if (sprite.current !== null) sprite.current.style.backgroundPosition = `${-frame * FRAME}px ${-DIRS.indexOf(st.dir) * FRAME}px`
    el.dataset.state = frame > 0 ? 'walking' : 'idle'
  }

  const tick = (time: number) => {
    const st = s.current
    st.raf = 0
    const { enabled, paused } = live.current
    if (!enabled || paused || document.hidden || st.pos === undefined || st.target === undefined) { draw(0); return }
    const { view, world } = viewRef.current
    if (st.dirty) {
      st.dirty = false
      const ob = st.obstacles.find(o => o.id === st.target)
      // 目标：图标左下方（脚底），找最近的安全点
      const goal = ob !== undefined ? nearestFree({ x: ob.raw.left + 8, y: ob.raw.bottom + 18 }, st.obstacles) : undefined
      st.route = goal !== undefined ? planRoute(view(st.pos), goal, st.obstacles)?.map(world) : undefined
    }
    if (st.route === undefined || st.route.length === 0) { st.target = undefined; draw(0); return }
    const dt = st.last ? Math.min((time - st.last) / 1000, 0.05) : 0
    st.last = time
    let budget = matchMedia('(prefers-reduced-motion: reduce)').matches ? Infinity : SPEED * dt
    while (st.route.length > 0) {
      const next = st.route[0], at: P = st.pos
      const dx = next.x - at.x, dy = next.y - at.y
      const left = Math.hypot(dx, dy)
      if (left > 0.001) {
        // 朝向按屏幕上的走向算（地面转了 45°，世界坐标的方向和看上去不一样）
        const v = view({ x: dx, y: dy })
        st.dir = Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'east' : 'west') : (v.y > 0 ? 'south' : 'north')
      }
      const step = Math.min(left, budget)
      if (left > 0) st.pos = { x: at.x + dx / left * step, y: at.y + dy / left * step }
      st.walked += step
      budget -= step
      if (step < left) break
      st.route.shift()
    }
    const walking = st.route.length > 0
    draw(walking ? 1 + Math.floor(st.walked / 20) % 4 : 0)
    if (walking) st.raf = requestAnimationFrame(tick)
    else st.target = undefined
  }

  const wake = () => {
    const st = s.current
    cancelAnimationFrame(st.raf)
    st.raf = 0
    st.last = 0
    if (st.pos !== undefined && st.target !== undefined && live.current.enabled && !live.current.paused) st.raf = requestAnimationFrame(tick)
    else draw(0)
  }

  // 量障碍：图标最终显示的范围（含内缩、抬高、放大），换算到缩放为 1 的投影画面，再按人物全身扩张
  useLayoutEffect(() => {
    const el = layer.current, root = rootRef.current, st = s.current
    if (el === null) return
    el.hidden = true
    if (!enabled || root === null) { wake(); return }
    const box = root.getBoundingClientRect()
    const origin = project(m, cam.x, cam.y, size.w, size.h)
    const obstacles: Obstacle[] = []
    for (const img of root.querySelectorAll<HTMLImageElement>('.mp-cell[data-cell-id] .mp-moon-relief img')) {
      const id = img.closest<HTMLElement>('[data-cell-id]')!.dataset.cellId!
      const r = img.getBoundingClientRect()
      if (r.width === 0) continue
      const a = alphaBounds(img, () => setMeasured(n => n + 1)) ?? { left: 0, top: 0, right: 1, bottom: 1 }
      const toView = (x: number, y: number) => ({ x: (x - box.left - origin.x) / cam.scale, y: (y - box.top - origin.y) / cam.scale })
      const lt = toView(r.left + r.width * a.left, r.top + r.height * a.top), rb = toView(r.left + r.width * a.right, r.top + r.height * a.bottom)
      const raw = { left: lt.x, top: lt.y, right: rb.x, bottom: rb.y }
      obstacles.push({ id, raw, left: raw.left - BODY.right - GAP, right: raw.right - BODY.left + GAP, top: raw.top - BODY.bottom - GAP, bottom: raw.bottom - BODY.top + GAP })
    }
    const changed = JSON.stringify(obstacles.map(o => [o.left, o.top, o.right, o.bottom].map(Math.round))) !== JSON.stringify(st.obstacles.map(o => [o.left, o.top, o.right, o.bottom].map(Math.round)))
    st.obstacles = obstacles
    if (changed) st.dirty = true
    // 出生：第一个图标的左下方；之后每次布局变了，先确认站的地方还安全
    const want = st.pos !== undefined ? view(st.pos) : obstacles[0] !== undefined ? { x: obstacles[0].raw.left - 20, y: obstacles[0].raw.bottom + 60 } : undefined
    const safe = want !== undefined ? nearestFree(want, obstacles) : undefined
    if (safe === undefined) { st.pos = undefined; return }
    st.pos = world(safe)
    el.hidden = false
    wake()
  }, [enabled, layoutKey, measured, cam.x, cam.y, cam.scale, size.w, size.h, m.a, m.b, m.c, m.d]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { wake() }, [paused]) // eslint-disable-line react-hooks/exhaustive-deps

  // 悬停图标（只认 .mp-moon，不用整格的 hover）；触屏不跟随
  useEffect(() => {
    const root = rootRef.current
    if (root === null || !enabled) return
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.buttons !== 0 || live.current.paused) return
      const id = (e.target as Element | null)?.closest?.('.mp-moon')?.closest<HTMLElement>('[data-cell-id]')?.dataset.cellId
      const st = s.current
      if (id === undefined || id === st.target) return
      st.target = id
      st.dirty = true
      wake()
    }
    const vis = () => wake()
    root.addEventListener('pointerover', over)
    document.addEventListener('visibilitychange', vis)
    return () => { root.removeEventListener('pointerover', over); document.removeEventListener('visibilitychange', vis) }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(s.current.raf), [])

  const ch = CHARACTERS[character], other = CHARACTERS[(character + 1) % CHARACTERS.length]
  // 只有身体范围接收点击：透明的画布留给下面的地图
  const clip = `inset(${ANCHOR.y + BODY.top}px ${FRAME - ANCHOR.x - BODY.right}px ${Math.max(0, FRAME - ANCHOR.y - BODY.bottom)}px ${ANCHOR.x + BODY.left}px)`
  return (
    <div ref={layer} className="mp-walker" hidden>
      <div className="mp-walker-shadow" />
      <button ref={sprite} type="button" className="mp-walker-sprite" aria-label={`现在是${ch.name}，点一下换成${other.name}`} title={`${ch.name}（点一下换人）`}
        style={{ left: -ANCHOR.x, top: -ANCHOR.y, width: FRAME, height: FRAME, backgroundImage: `url("${fileUrl('pixel', `walker/walk-${ch.id}.png`)}")`, backgroundSize: `${FRAME * 5}px ${FRAME * 4}px`, clipPath: clip }}
        onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setCharacter(c => (c + 1) % CHARACTERS.length) }} />
    </div>
  )
}
