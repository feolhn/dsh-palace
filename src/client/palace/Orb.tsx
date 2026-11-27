/**
 * AI 光球（#29 第三步，移植原型 palace-orb.js 的 PalaceOrb）：一个透明、有弹性的小球，漂在宫殿的空格子里。
 * 点它打开对话；长按拖到别的空格（记在本机）；阅读时缩小待在书的右上角斜对面。
 * 动画直接改 DOM（每帧一次 transform），不走 React 渲染。
 */
import { useEffect, useRef, useState } from 'react'
import {
  candidates, collideCursor, emptyCell, readerArea, relaxSpeed, scaleFor, SIZE, spawn, step,
  type Ball, type Bounds, type Cell, type OrbView, type Rect,
} from './orb.ts'

const PREFERRED_KEY = 'dsh-palace:orb-cell'
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function preferred(): { col: number; row: number } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(PREFERRED_KEY) ?? 'null') as { col: number; row: number } | null
    return v !== null && Number.isInteger(v.col) && Number.isInteger(v.row) ? v : undefined
  } catch { return undefined }
}

/** 视图里决定光球位置的部分（数据刷新但格子没动时不用重新放）。 */
function signature(view: OrbView | undefined): string {
  if (view === undefined) return ''
  const r = (n: number) => Math.round(n)
  return JSON.stringify([r(view.width), r(view.height), r(view.x), r(view.y), r(view.spacing), view.occupied.map(c => `${c.col},${c.row}`).sort(),
    view.exclusions.map(e => [r(e.x), r(e.y), r(e.w), r(e.h)]), view.readerRect && [r(view.readerRect.x), r(view.readerRect.y), r(view.readerRect.w), r(view.readerRect.h)]])
}

export function Orb({ view, label, open, onToggle, onNoRoom }: {
  /** undefined = 现在不该出现（轴测、拖动中、打开了笔记……） */
  view?: OrbView
  label: string
  /** 对话开着：光球停住，位置不变。 */
  open: boolean
  /** 点了光球：传入它在宫殿里的位置（打开对话面板用）。 */
  onToggle: (at: Rect) => void
  /** 光球出现 / 消失（没地方放时宫殿要显示备用的 AI 按钮）。 */
  /** 光球找不到地方放（窗口太小、格子太密）：true 时宫殿显示备用入口。重新找位置时先回到 false，不在等待期间闪备用按钮。 */
  onNoRoom?: (noRoom: boolean) => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [target, setTarget] = useState<Rect>()
  const s = useRef<{
    view?: OrbView; cell?: Rect & { col?: number; row?: number }; ball?: Ball; bounds?: Bounds; cruise: number; scale: number
    cursor?: { x: number; y: number; vx: number; vy: number; time: number }; rest: boolean
    press?: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    drag?: { x: number; y: number; drop?: Cell }; hold?: ReturnType<typeof setTimeout>; ignoreClickUntil: number; open: boolean
  }>({ cruise: 0, scale: 1, rest: false, ignoreClickUntil: 0, open })
  s.current.open = open
  const onNoRoomRef = useRef(onNoRoom)
  onNoRoomRef.current = onNoRoom
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  const draw = () => {
    const st = s.current, b = st.ball, el = button.current
    if (!b || !st.cell || !el || !st.bounds) return
    const r = st.bounds.radius - 1
    const x = st.drag ? st.drag.x : st.cell.x + clamp(b.x, r * b.sx + 1, st.cell.w - r * b.sx - 1)
    const y = st.drag ? st.drag.y : st.cell.y + clamp(b.y, r * b.sy + 1, st.cell.h - r * b.sy - 1)
    el.style.transform = `translate(${x - SIZE / 2}px,${y - SIZE / 2}px) scale(${st.scale * b.sx},${st.scale * b.sy})`
  }

  /** 鼠标慢慢靠近、或者停在球上：球停下来，方便点。 */
  const updateRest = () => {
    const st = s.current
    if (!st.ball || !st.cursor || !st.cell || !st.bounds) { st.rest = false; return }
    const r = st.bounds.radius, d = Math.hypot(st.cursor.x - st.cell.x - st.ball.x, st.cursor.y - st.cell.y - st.ball.y)
    const speed = performance.now() - st.cursor.time > 100 ? 0 : Math.hypot(st.cursor.vx, st.cursor.vy)
    st.rest = (st.rest && d <= r + 24) || d <= r * 0.65 || (d <= r + 14 && speed < 140)
  }
  const canCollide = () => {
    const st = s.current
    return st.ball !== undefined && !st.rest && st.press === undefined && !reduce && !st.open && document.activeElement !== button.current
  }

  // 视图变了（平移、缩放、开书）：先藏起来，停 0.7 秒再在新位置出现；对话开着时不动
  const sig = signature(view)
  useEffect(() => {
    const st = s.current
    if (st.open && st.ball) return
    st.view = view
    st.ball = undefined
    st.drag = undefined
    st.press = undefined
    setVisible(false)
    setTarget(undefined)
    onNoRoomRef.current?.(false)
    if (view === undefined) return
    let frame = 0
    const timer = setTimeout(() => {
      const area = view.readerRect !== undefined ? readerArea(view) : undefined
      let cell: (Rect & { col?: number; row?: number }) | undefined = area
      if (view.readerRect !== undefined && area === undefined) { onNoRoomRef.current?.(true); return }
      if (cell === undefined) {
        const p = preferred()
        cell = p ? emptyCell(view, p.col, p.row) : undefined
      }
      if (cell === undefined) {
        const pools = candidates(view)
        if (pools.length === 0) { onNoRoomRef.current?.(true); return }
        const pool = pools[Math.floor(Math.random() * pools.length)]
        cell = pool[Math.floor(Math.random() * pool.length)]
      }
      st.cell = cell
      st.scale = scaleFor(view, area)
      const radius = SIZE * st.scale / 2 + 1
      st.bounds = { w: cell.w, h: cell.h, radius }
      const { ball, cruise } = spawn(cell, view, radius)
      st.ball = ball
      st.cruise = cruise
      setVisible(true)
      draw()
      if (reduce) return
      let previous = performance.now()
      const tick = (now: number) => {
        if (!st.ball || !st.bounds || !st.cell) return
        const dt = Math.min((now - previous) / 1000, 0.04)
        previous = now
        updateRest()
        if (!st.rest && !st.press && !st.open && document.activeElement !== button.current) {
          step(st.ball, st.bounds, dt)
          if (canCollide() && st.cursor) collideCursor(st.ball, st.bounds, { x: st.cursor.x - st.cell.x, y: st.cursor.y - st.cell.y, vx: 0, vy: 0 }, st.cruise)
          relaxSpeed(st.ball, st.cruise, dt)
        } else {
          st.ball.sx += (1 - st.ball.sx) * Math.min(1, dt * 9)
          st.ball.sy += (1 - st.ball.sy) * Math.min(1, dt * 9)
        }
        draw()
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    }, 700)
    return () => { clearTimeout(timer); cancelAnimationFrame(frame) }
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  // 鼠标（没按键）在宫殿里移动：记下位置和速度，撞到球就弹开
  useEffect(() => {
    const root = button.current?.parentElement
    if (!root) return
    const onMove = (e: PointerEvent) => {
      const st = s.current
      if (e.pointerType !== 'mouse' || e.buttons !== 0) { st.cursor = undefined; st.rest = false; return }
      const box = root.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top
      const now = performance.now(), prev = st.cursor, dt = prev ? Math.max(0.008, (now - prev.time) / 1000) : 1
      const vx = prev ? clamp((x - prev.x) / dt, -800, 800) : 0, vy = prev ? clamp((y - prev.y) / dt, -800, 800) : 0
      st.cursor = { x, y, vx, vy, time: now }
      updateRest()
      if (!canCollide() || !st.cell || !st.bounds || !st.ball) return
      collideCursor(st.ball, st.bounds, { x: x - st.cell.x, y: y - st.cell.y, vx, vy, ...(prev ? { fromX: prev.x - st.cell.x, fromY: prev.y - st.cell.y } : {}) }, st.cruise)
      draw()
    }
    const onLeave = () => { s.current.cursor = undefined; s.current.rest = false }
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    return () => { root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave) }
  }, [])

  // ---------- 按下：点一下开对话；长按 0.5 秒拖到别的空格 ----------
  const endPress = (e: { pointerId: number } | undefined, canceled = false) => {
    const st = s.current
    if (!st.press || (e && e.pointerId !== st.press.id)) return
    clearTimeout(st.hold)
    const dragged = st.drag !== undefined
    if (dragged && !canceled && st.drag?.drop && st.bounds && st.ball) {
      const drop = st.drag.drop
      st.cell = drop
      localStorage.setItem(PREFERRED_KEY, JSON.stringify({ col: drop.col, row: drop.row }))
      st.ball.x = clamp(st.drag.x - drop.x, st.bounds.radius, drop.w - st.bounds.radius)
      st.ball.y = clamp(st.drag.y - drop.y, st.bounds.radius, drop.h - st.bounds.radius)
    }
    if (dragged || st.press.moved || canceled) st.ignoreClickUntil = performance.now() + 500
    const id = st.press.id
    st.press = undefined
    st.drag = undefined
    setTarget(undefined)
    button.current?.classList.remove('mp-orb-holding', 'mp-orb-dragging')
    if (button.current?.hasPointerCapture(id)) button.current.releasePointerCapture(id)
    if (dragged) button.current?.blur()
    draw()
  }

  if (view === undefined && !visible) return <button ref={button} type="button" className="mp-orb" hidden />
  return (
    <>
      {target && <div className="mp-orb-target" style={{ left: target.x, top: target.y, width: target.w, height: target.h }} />}
      <button ref={button} type="button" className="mp-orb" hidden={!visible} aria-label={label} aria-expanded={open}
        title={view?.readerRect ? '和这本书对话' : '和宫殿对话（长按可以拖到别的空格）'}
        onContextMenu={e => e.preventDefault()} onDragStart={e => e.preventDefault()}
        onPointerDown={(e) => {
          e.stopPropagation()
          const st = s.current
          if (!st.ball || !st.cell || e.button > 0) return
          const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
          const x = e.clientX - box.left, y = e.clientY - box.top
          st.cursor = undefined
          st.rest = false
          st.press = { id: e.pointerId, sx: x, sy: y, ox: x - st.cell.x - st.ball.x, oy: y - st.cell.y - st.ball.y, moved: false }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
          if (st.view?.readerRect) return // 阅读时不能拖
          e.currentTarget.classList.add('mp-orb-holding')
          st.hold = setTimeout(() => {
            if (!st.press || st.press.moved || !st.ball || !st.cell) return
            st.drag = { x: st.cell.x + st.ball.x, y: st.cell.y + st.ball.y, drop: st.cell.col !== undefined ? st.cell as Cell : undefined }
            st.ball.sx = 1; st.ball.sy = 1
            button.current?.classList.add('mp-orb-dragging')
            setTarget(st.drag.drop)
            draw()
          }, 500)
        }}
        onPointerMove={(e) => {
          const st = s.current
          if (!st.press || e.pointerId !== st.press.id || !st.view) return
          e.stopPropagation()
          const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
          const x = e.clientX - box.left, y = e.clientY - box.top
          if (!st.drag) {
            if (Math.hypot(x - st.press.sx, y - st.press.sy) > 8) { st.press.moved = true; clearTimeout(st.hold) }
            return
          }
          const r = SIZE * st.scale / 2, v = st.view
          st.drag.x = clamp(x - st.press.ox, r, v.width - r)
          st.drag.y = clamp(y - st.press.oy, r, v.height - r)
          const col = Math.floor((st.drag.x - v.x) / v.spacing), row = Math.floor((st.drag.y - v.y) / v.spacing)
          st.drag.drop = x >= 0 && x <= v.width && y >= 0 && y <= v.height ? emptyCell(v, col, row) : undefined
          setTarget(st.drag.drop)
          draw()
        }}
        onPointerUp={e => { e.stopPropagation(); endPress(e) }}
        onPointerCancel={e => endPress(e, true)}
        onLostPointerCapture={e => endPress(e, true)}
        onClick={(e) => {
          e.stopPropagation()
          if (performance.now() < s.current.ignoreClickUntil) return
          const el = e.currentTarget, box = (el.parentElement as HTMLElement).getBoundingClientRect(), r = el.getBoundingClientRect()
          onToggle({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height })
        }}
        onKeyDown={(e) => { if (e.key === 'Escape' && s.current.press) { e.preventDefault(); endPress(undefined, true) } }}>
        AI
      </button>
    </>
  )
}
