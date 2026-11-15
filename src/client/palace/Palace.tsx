/**
 * 宫殿画布（全屏）：无限格子，拖动平移、缩放；拖格子换位置；点分组展开；点书 / 笔记打开详情。
 *
 * 坐标：世界坐标里格子 (col,row) 的左上角在 (col*B, row*B)；屏幕坐标 = 世界坐标 * scale + (x, y)。
 * 视觉参考设计负责人的原型（蓝纸、白色网格线、去封面的标准排版），代码是重写的。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Cell, CellSummary } from '../../shared/palace.ts'
import { AddDialog } from './AddDialog.tsx'
import { CellSheet } from './CellSheet.tsx'
import { palaceOp, usePalace } from './data.ts'

/** 格子边长（scale = 1 时的像素）。 */
const B = 268
const MIN_SCALE = 0.35
const MAX_SCALE = 2.4
/** 按下后移动超过这个距离才算拖动，否则算点击。 */
const DRAG_THRESHOLD = 5

interface Camera { x: number; y: number; scale: number }
interface Size { w: number; h: number }

/** 拖出窗口也能继续收到移动事件。个别环境（如脚本模拟的事件）会拒绝，忽略即可。 */
function capture(el: Element, pointerId: number): void {
  try { el.setPointerCapture(pointerId) } catch { /* 忽略 */ }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 分组展开后的大小：至少 2×2，内容多了往右下扩；拖动时多留一圈空位方便放进去。 */
function groupSize(cells: Cell[], groupId: string, spare: boolean): { cols: number; rows: number } {
  let cols = 2, rows = 2
  for (const c of cells) {
    if (c.parentId !== groupId) continue
    cols = Math.max(cols, c.col + 1)
    rows = Math.max(rows, c.row + 1)
  }
  return spare ? { cols: cols + 1, rows: rows + 1 } : { cols, rows }
}

/** 让最外层的所有格子都落在视野里。 */
function fitCamera(cells: Cell[], size: Size): Camera {
  const roots = cells.filter(c => c.parentId === null)
  if (roots.length === 0) return { x: size.w / 2 - B / 2, y: size.h / 2 - B / 2, scale: 1 }
  const left = Math.min(...roots.map(c => c.col)) * B, right = (Math.max(...roots.map(c => c.col)) + 1) * B
  const top = Math.min(...roots.map(c => c.row)) * B, bottom = (Math.max(...roots.map(c => c.row)) + 1) * B
  // 不为了「全部塞进来」缩到看不清：最小 0.6，放不下的拖动去看
  const scale = clamp(Math.min((size.w - 80) / (right - left), (size.h - 140) / (bottom - top), 1), 0.6, 1)
  return { x: size.w / 2 - (left + right) / 2 * scale, y: size.h / 2 - (top + bottom) / 2 * scale, scale }
}

type Gesture =
  | { kind: 'pan'; id: number; sx: number; sy: number; cam: Camera; moved: boolean }
  | { kind: 'cell'; id: number; sx: number; sy: number; cell: Cell; moved: boolean; px: number; py: number }

export function Palace() {
  const { palace, summaries, error } = usePalace()
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [cam, setCam] = useState<Camera>()
  const [openGroup, setOpenGroup] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [gesture, setGesture] = useState<Gesture>()
  const [opError, setOpError] = useState<string>()

  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 第一次拿到数据和尺寸时，把镜头对准所有格子
  useEffect(() => {
    if (cam === undefined && palace !== undefined && size.w > 0) setCam(fitCamera(palace.cells, size))
  }, [cam, palace, size])

  // 打开的分组或选中的格子被删了（比如 AI 删的），就收起
  const cells = palace?.cells ?? []
  useEffect(() => {
    if (openGroup !== undefined && !cells.some(c => c.id === openGroup)) setOpenGroup(undefined)
    if (selected !== undefined && !cells.some(c => c.id === selected)) setSelected(undefined)
  }, [cells, openGroup, selected])

  useEffect(() => {
    if (opError === undefined) return
    const t = setTimeout(() => setOpError(undefined), 4000)
    return () => clearTimeout(t)
  }, [opError])

  const run = (op: string, args: Record<string, unknown>) => palaceOp(op, args).catch((e: Error) => setOpError(e.message))

  // ---------- 镜头 ----------

  const zoomAt = (factor: number, sx: number, sy: number) => setCam((c) => {
    if (c === undefined) return c
    const scale = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE)
    const r = scale / c.scale
    return { scale, x: sx - (sx - c.x) * r, y: sy - (sy - c.y) * r }
  })

  useEffect(() => {
    const el = rootRef.current
    if (el === null) return
    // 触控板：双指滑动 = 平移，捏合（浏览器报为 ctrl + wheel）= 缩放；鼠标滚轮 + ⌘ 也是缩放
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.mp-sheet, .mp-dialog')) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      else setCam(c => (c === undefined ? c : { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---------- 拖动 ----------

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button !== 0 || cam === undefined) return
    const p = local(e)
    capture(e.currentTarget as Element, e.pointerId)
    setGesture({ kind: 'pan', id: e.pointerId, sx: p.x, sy: p.y, cam, moved: false })
  }

  const onCellDown = (e: RPointerEvent, cell: Cell) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = local(e)
    capture(rootRef.current!, e.pointerId)
    setGesture({ kind: 'cell', id: e.pointerId, sx: p.x, sy: p.y, cell, moved: false, px: p.x, py: p.y })
  }

  const onMove = (e: RPointerEvent) => {
    if (gesture === undefined || e.pointerId !== gesture.id) return
    const p = local(e)
    const moved = gesture.moved || Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > DRAG_THRESHOLD
    if (gesture.kind === 'pan') {
      if (moved) setCam({ ...gesture.cam, x: gesture.cam.x + p.x - gesture.sx, y: gesture.cam.y + p.y - gesture.sy })
      if (moved !== gesture.moved) setGesture({ ...gesture, moved })
    } else {
      setGesture({ ...gesture, moved, px: p.x, py: p.y })
    }
  }

  const onUp = (e: RPointerEvent) => {
    if (gesture === undefined || e.pointerId !== gesture.id) return
    setGesture(undefined)
    if (gesture.kind === 'pan') {
      // 在空白处点一下：先收起详情，再收起分组
      if (!gesture.moved) {
        if (selected !== undefined) setSelected(undefined)
        else setOpenGroup(undefined)
      }
      return
    }
    const { cell } = gesture
    if (!gesture.moved) {
      if (cell.kind === 'group') { setOpenGroup(cell.id); setSelected(undefined) } else setSelected(cell.id)
      return
    }
    if (cam === undefined) return
    const target = dropTarget(cells, cam, openGroup, { x: gesture.px, y: gesture.py }, true)
    if (target === undefined) return
    if (target.parentId === cell.parentId && target.col === cell.col && target.row === cell.row) return
    // 最外层：把书 / 笔记拖到一个分组上 = 放进这个分组
    const onto = cells.find(c => c.parentId === target.parentId && c.col === target.col && c.row === target.row)
    if (onto?.kind === 'group' && cell.kind !== 'group' && target.parentId === null) {
      void run('moveCell', { id: cell.id, parentId: onto.id })
      return
    }
    void run('moveCell', { id: cell.id, ...target })
  }

  // ---------- 渲染 ----------

  const dragging = gesture?.kind === 'cell' && gesture.moved ? gesture : undefined
  const group = openGroup !== undefined ? cells.find(c => c.id === openGroup) : undefined
  const gsize = group !== undefined ? groupSize(cells, group.id, dragging !== undefined) : undefined
  const roots = cells.filter(c => c.parentId === null)
  const children = group !== undefined ? cells.filter(c => c.parentId === group.id) : []
  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) if (c.parentId !== null) m.set(c.parentId, (m.get(c.parentId) ?? 0) + 1)
    return m
  }, [cells])

  // 分组展开后，被框盖住的最外层格子先不画（避免透出来）
  const covered = (c: Cell) => group !== undefined && gsize !== undefined
    && c.col >= group.col && c.col < group.col + gsize.cols && c.row >= group.row && c.row < group.row + gsize.rows
  const target = dragging !== undefined && cam !== undefined ? dropTarget(cells, cam, openGroup, { x: dragging.px, y: dragging.py }, true) : undefined

  const place = (col: number, row: number, base?: Cell) => {
    if (cam === undefined) return {}
    const ox = base !== undefined ? base.col * B : 0, oy = base !== undefined ? base.row * B : 0
    return { left: cam.x + (ox + col * B) * cam.scale, top: cam.y + (oy + row * B) * cam.scale, width: B * cam.scale, height: B * cam.scale }
  }

  const renderCell = (c: Cell, base?: Cell) => {
    const isDragged = dragging?.cell.id === c.id
    const style = place(c.col, c.row, base)
    const shifted = isDragged && cam !== undefined
      ? { ...style, left: (style.left ?? 0) + dragging.px - dragging.sx, top: (style.top ?? 0) + dragging.py - dragging.sy }
      : style
    return (
      <div key={c.id} className={`mp-cell mp-${c.kind} ${isDragged ? 'mp-lifted' : ''} ${selected === c.id ? 'mp-selected' : ''}`}
        style={{ ...shifted, fontSize: 16 * (cam?.scale ?? 1) }}
        onPointerDown={e => onCellDown(e, c)}>
        <CellFace cell={c} summary={summaries[c.id]} count={childCount.get(c.id) ?? 0} />
      </div>
    )
  }

  return (
    <div ref={rootRef} className={`mp-root ${gesture?.kind === 'pan' && gesture.moved ? 'mp-panning' : ''}`}
      onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setGesture(undefined)}>
      <div className="mp-paper" />
      {cam !== undefined && <Grid cam={cam} size={size} />}

      {roots.filter(c => !covered(c)).map(c => renderCell(c))}

      {group !== undefined && gsize !== undefined && cam !== undefined && (
        <>
          <div className="mp-dim" />
          <div className="mp-group-frame" style={{ ...place(0, 0, group), width: gsize.cols * B * cam.scale, height: gsize.rows * B * cam.scale }} />
          {children.map(c => renderCell(c, group))}
        </>
      )}

      {target !== undefined && cam !== undefined && (
        <div className="mp-drop" style={target.parentId === null ? place(target.col, target.row) : place(target.col, target.row, group)} />
      )}

      <header className="mp-masthead">
        <span className="mp-wordmark">Memory Palace</span>
        {group !== undefined && <GroupBar group={group} empty={children.length === 0} onBack={() => setOpenGroup(undefined)} onError={setOpError} />}
      </header>

      {palace !== undefined && cells.length === 0 && (
        <div className="mp-empty">宫殿还是空的。点右下角的 ＋ 放进第一本书，或者写一条笔记。</div>
      )}
      {(error ?? opError) && <div className="mp-toast">{opError ?? `加载失败：${error}`}</div>}

      <footer className="mp-footer" onPointerDown={e => e.stopPropagation()}>
        <button type="button" className="mp-round" title="添加" onClick={() => setAdding(true)}>＋</button>
        <div className="mp-zoom">
          <button type="button" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} disabled={(cam?.scale ?? 1) <= MIN_SCALE + 0.001}>−</button>
          <button type="button" className="mp-zoom-reset" title="显示全部" onClick={() => palace && setCam(fitCamera(palace.cells, size))}>{Math.round((cam?.scale ?? 1) * 100)}%</button>
          <button type="button" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)} disabled={(cam?.scale ?? 1) >= MAX_SCALE - 0.001}>＋</button>
        </div>
      </footer>

      {selected !== undefined && palace !== undefined && palace.cells.some(c => c.id === selected) && (
        <CellSheet palace={palace} cellId={selected} onClose={() => setSelected(undefined)} />
      )}
      {adding && <AddDialog parentId={group?.id} onClose={() => setAdding(false)} />}
    </div>
  )
}

/** 分组展开时左上角：返回、改名、删除空分组。 */
function GroupBar({ group, empty, onBack, onError }: { group: Cell; empty: boolean; onBack: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState(group.title)
  useEffect(() => setTitle(group.title), [group.title])
  const save = () => {
    if (title.trim() === group.title) return
    palaceOp('updateCell', { id: group.id, title }).catch((e: Error) => { setTitle(group.title); onError(e.message) })
  }
  return (
    <div className="mp-groupbar" onPointerDown={e => e.stopPropagation()}>
      <button type="button" className="mp-text-btn" onClick={onBack}>← 返回宫殿</button>
      <input value={title} onChange={e => setTitle(e.target.value)} onBlur={save} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {empty && <button type="button" className="mp-text-btn mp-danger" onClick={() => palaceOp('deleteCell', { id: group.id }).then(onBack, (e: Error) => onError(e.message))}>删除空分组</button>}
    </div>
  )
}

/** 拖动松手时落在哪一格。分组展开时，落在框里 = 组内坐标，落在框外 = 最外层。 */
function dropTarget(cells: Cell[], cam: Camera, openGroup: string | undefined, p: { x: number; y: number }, spare: boolean): { parentId: string | null; col: number; row: number } | undefined {
  const wx = (p.x - cam.x) / cam.scale, wy = (p.y - cam.y) / cam.scale
  const col = Math.floor(wx / B), row = Math.floor(wy / B)
  const group = openGroup !== undefined ? cells.find(c => c.id === openGroup) : undefined
  if (group !== undefined) {
    const { cols, rows } = groupSize(cells, group.id, spare)
    const gc = col - group.col, gr = row - group.row
    if (gc >= 0 && gr >= 0 && gc < cols && gr < rows) return { parentId: group.id, col: gc, row: gr }
  }
  return { parentId: null, col, row }
}

function CellFace({ cell, summary, count }: { cell: Cell; summary?: CellSummary; count: number }) {
  let meta: string | undefined
  if (cell.kind === 'group') meta = `${count} 项`
  else if (summary !== undefined) {
    if (summary.finished) meta = '读完了'
    else if (summary.total > 0) meta = `${summary.done} / ${summary.total}${summary.perDay !== undefined && summary.perDay > 0 ? ` · 每天约 ${summary.perDay} 节` : ''}`
    else if (summary.cards > 0) meta = `${summary.cards} 张卡片`
  }
  return (
    <>
      {meta !== undefined && <span className="mp-cell-meta">{meta}</span>}
      <span className="mp-cell-title">
        {cell.subtitle !== undefined && <span className="mp-cell-sub">{cell.subtitle}</span>}
        {cell.title}
      </span>
    </>
  )
}

/** 网格线和交点。只画视野里的部分。 */
function Grid({ cam, size }: { cam: Camera; size: Size }) {
  const step = B * cam.scale
  const xs: number[] = [], ys: number[] = []
  for (let i = Math.floor(-cam.x / step); i <= Math.ceil((size.w - cam.x) / step); i++) xs.push(cam.x + i * step)
  for (let i = Math.floor(-cam.y / step); i <= Math.ceil((size.h - cam.y) / step); i++) ys.push(cam.y + i * step)
  const r = clamp(3.1 * Math.sqrt(cam.scale), 1.8, 4.2)
  return (
    <svg className="mp-grid" width={size.w} height={size.h}>
      <g className="mp-lines">
        {xs.map(x => <line key={`x${x}`} x1={x} x2={x} y1={0} y2={size.h} />)}
        {ys.map(y => <line key={`y${y}`} y1={y} y2={y} x1={0} x2={size.w} />)}
      </g>
      <g className="mp-dots">
        {xs.flatMap(x => ys.map(y => <circle key={`${x},${y}`} cx={x} cy={y} r={r} />))}
      </g>
    </svg>
  )
}

