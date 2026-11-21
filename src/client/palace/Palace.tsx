/**
 * 宫殿画布（全屏）：无限格子，拖动平移、缩放；拖格子换位置；点分组展开；点书 / 笔记打开详情。
 *
 * 坐标：世界坐标里格子 (col,row) 的左上角在 (col*B, row*B)；平面屏幕坐标 = 世界坐标 * scale + (x, y)，
 * 再经过轴测投影（projection.ts，amount = 0 时就是原样）。每个元素用一个 matrix() 放到屏幕上。
 * 视觉参考设计负责人的原型（蓝纸、白色网格线、去封面的标准排版）；轴测视图（#42）移植自原型代码。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import type { Cell, CellSummary } from '../../shared/palace.ts'
import { AddDialog } from './AddDialog.tsx'
import { Room, RoomTabs } from './Room.tsx'
import { Orb } from './Orb.tsx'
import type { OrbView, Rect } from './orb.ts'
import { EpubReader } from '../readers/EpubReader.tsx'
import { useItem } from './data.ts'
import type { NotebookTab } from '../notebook/Notebook.tsx'
import { Moon, percentText } from './Moon.tsx'
import { iconOf } from './icons.ts'
import { ReadBook } from './ReadBook.tsx'
import { PalaceChat } from '../chat/PalaceChat.tsx'
import { palaceOp, useArcs, usePalace } from './data.ts'
import { Arcs } from './Arcs.tsx'
import { delta, matrixOf, project, spreadDrop, spreadLayout, unproject, type Matrix, type SpreadLayout } from './projection.ts'
import { lightScheme } from './light.ts'
import { GroupNameDialog } from './GroupNameDialog.tsx'

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

/** 轴测视图的镜头：展开后的全部格子落在视野里（投影后宽高按 45° 旋转、54.7° 倾斜估算）。 */
function spreadCamera(layout: SpreadLayout, cells: Cell[], size: Size): Camera {
  const roots = layout.roots
  if (roots.length === 0) return fitCamera(cells, size)
  const left = Math.min(...roots.map(c => c.col)) * B, right = Math.max(...roots.map(c => c.col + c.w)) * B
  const top = Math.min(...roots.map(c => c.row)) * B, bottom = Math.max(...roots.map(c => c.row + c.h)) * B
  const pw = (right - left + bottom - top) / Math.SQRT2, ph = (right - left + bottom - top) / Math.sqrt(6)
  const scale = clamp(Math.min((size.w - 110) / pw, (size.h - 210) / ph, 1), MIN_SCALE, 1)
  return { x: size.w / 2 - (left + right) / 2 * scale, y: size.h / 2 + 12 - (top + bottom) / 2 * scale, scale }
}

/** amount 投影程度，spread 分组展开程度，open 阅览室展开程度（都是 0–1，动画中是小数）。 */
interface Proj { amount: number; spread: number; open: number }

/** 阅览室的大小（原型 dimensions()）和要不要给左边的对话留位置。 */
const CHAT_W = 300
function roomSize(size: Size, chat: boolean, mode: RoomMode): { w: number; h: number; beside: boolean } {
  // 阅读时书占大部分画面（原型 1140×790），对话不贴边（用光球）
  if (mode === 'reader') return { w: Math.max(300, Math.min(1140, size.w - 40)), h: Math.max(230, Math.min(790, size.h - 170)), beside: false }
  const beside = chat && size.w >= 760
  const avail = size.w - 40 - (beside ? CHAT_W + 16 : 0)
  return { w: Math.max(300, Math.min(840, avail)), h: Math.max(230, Math.min(730, size.h - 180)), beside }
}
type RoomMode = 'notes' | 'reader'
/** 阅览室左边那一列网格里放对话（左右各留 12px，对齐网格线）。窄屏（beside = false）不贴边，改成浮层。
 *  展开动画中 column 还在变；阅览室最后总是 scale 1（一列 B 宽，放得下），所以只按 beside 决定，不按动画中的宽度，免得中途从浮层跳到贴边（#66）。 */
function besideDock(beside: boolean, sx: number, sy: number, height: number, column: number) {
  return beside ? { left: sx - column + 12, top: sy, width: Math.max(0, column - 24), height } : undefined
}
/** 光球打开的对话面板大小（原型 #palace-ai-chat 是 260×350，嵌原生对话放大一些）。 */
const ORB_CHAT = { w: 340, h: 520 }
/** 空对话时可以点的开头（设计稿原文；宫殿的第二条是新加的）。 */
const BOOK_PROMPTS = ['这段文字，让我想起……', '这个想法与我读过的书，有什么联系？']
const PALACE_PROMPTS = ['这个想法与我读过的书，有什么联系？', '最近读的几本书，可以放在一起看吗？']
const VIEW_KEY = 'dsh-shelf:view'
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

type Gesture =
  | { kind: 'pan'; id: number; sx: number; sy: number; cam: Camera; moved: boolean }
  | { kind: 'cell'; id: number; sx: number; sy: number; cell: Cell; moved: boolean; px: number; py: number }

export function Palace() {
  const { palace, summaries, error } = usePalace()
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  const [cam, setCam] = useState<Camera>()
  /** 正在阅读的格子（点月亮进入）。 */
  /** 用系统程序打开的原文（PDF、视频）。EPUB 在阅览室这一格里读（roomMode = reader）。 */
  const [reading, setReading] = useState<string>()
  const [roomMode, setRoomMode] = useState<RoomMode>('notes')
  /** 光球打开的对话：光球在屏幕上的位置。 */
  const [orbChat, setOrbChat] = useState<Rect>()
  const [orbShown, setOrbShown] = useState(false)
  const [openGroup, setOpenGroup] = useState<string>()
  /** 分组展开程度 0–1（进出分组时镜头推近 / 拉远，约 650ms，原型 groupProgress）。 */
  const [gp, setGp] = useState(0)
  const groupReturn = useRef<Camera>()
  /** 刚拖成的新分组：弹出命名框。 */
  const [naming, setNaming] = useState<Cell>()
  const [selected, setSelected] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [gesture, setGesture] = useState<Gesture>()
  const [opError, setOpError] = useState<string>()
  // AI 对话面板开着没有（记在本机，下次打开宫殿还是这样）
  const [chatOpen, setChatOpenState] = useState(() => localStorage.getItem('dsh-shelf:chat-open') === '1')
  // 「与书对话」的会话：交给阅览室里的笔记本（存灵感、生成目录要往这个对话发消息）
  const [roomSession, setRoomSession] = useState<{ cellId: string; sessionId: string }>()
  const setChatOpen = (open: boolean) => { localStorage.setItem('dsh-shelf:chat-open', open ? '1' : '0'); setChatOpenState(open) }
  // 轴测视图（记在本机）。proj 是动画中的当前值：amount 投影程度，spread 分组展开程度
  const [iso, setIso] = useState(() => localStorage.getItem(VIEW_KEY) === 'iso')
  const [proj, setProj] = useState<Proj>(() => (iso ? { amount: 1, spread: 1, open: 0 } : { amount: 0, spread: 0, open: 0 }))
  const [tab, setTab] = useState<NotebookTab>('progress')
  /** 打开阅览室前的镜头，关上时回去。 */
  const beforeRoom = useRef<Camera>()
  /** 正在关上的阅览室（动画结束前还要画）。 */
  const lastRoom = useRef<string>()
  const [hover, setHover] = useState<string>()
  const live = useRef({ iso, proj, cam, size, m: matrixOf(proj.amount), gp: 0 })
  const anim = useRef(0)
  const flatCam = useRef<Camera>()

  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 第一次拿到数据和尺寸时，把镜头对准所有格子
  const cells = palace?.cells ?? []
  const layout = useMemo(() => spreadLayout(cells), [cells])
  const m = matrixOf(proj.amount)
  live.current = { iso, proj, cam, size, m, gp: live.current.gp }

  useEffect(() => {
    if (cam === undefined && palace !== undefined && size.w > 0) setCam(iso ? spreadCamera(layout, palace.cells, size) : fitCamera(palace.cells, size))
  }, [cam, palace, size, iso, layout])

  /** 平滑过渡到目标投影（和镜头），650ms；新的过渡会打断旧的。 */
  const animate = (to: Proj, toCam?: Camera) => {
    const id = ++anim.current
    const from = live.current.proj, fromCam = live.current.cam
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
    const start = performance.now()
    const frame = (now: number) => {
      if (id !== anim.current) return
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1, e = ease(t)
      const p = { amount: from.amount + (to.amount - from.amount) * e, spread: from.spread + (to.spread - from.spread) * e, open: from.open + (to.open - from.open) * e }
      live.current.proj = p
      setProj(p)
      if (toCam !== undefined && fromCam !== undefined) {
        setCam({ x: fromCam.x + (toCam.x - fromCam.x) * e, y: fromCam.y + (toCam.y - fromCam.y) * e, scale: fromCam.scale + (toCam.scale - fromCam.scale) * e })
      }
      if (t < 1) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  /** 进出分组：分组框从一格长到整组、镜头推到 100%；退出时反过来，结束后才真正收起（#40）。 */
  const tweenGroup = (to: 0 | 1, toCam: Camera | undefined, done?: () => void) => {
    const id = ++anim.current
    const from = live.current.gp, fromCam = live.current.cam
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
    const start = performance.now()
    const frame = (now: number) => {
      if (id !== anim.current) return
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1, e = ease(t)
      const g = from + (to - from) * e
      live.current.gp = g
      setGp(g)
      if (toCam !== undefined && fromCam !== undefined) {
        setCam({ x: fromCam.x + (toCam.x - fromCam.x) * e, y: fromCam.y + (toCam.y - fromCam.y) * e, scale: fromCam.scale + (toCam.scale - fromCam.scale) * e })
      }
      if (t < 1) requestAnimationFrame(frame)
      else done?.()
    }
    requestAnimationFrame(frame)
  }
  const enterGroup = (g: Cell) => {
    const c = live.current.cam, sz = live.current.size
    if (c === undefined) return
    groupReturn.current = c
    setOpenGroup(g.id)
    setSelected(undefined)
    // 原型 groupCamera：缩放回到 100%，从分组原来那一格的位置展开（放不下才往里挪），不重新居中
    const { cols, rows } = groupSize(cells, g.id, false)
    const w = cols * B, h = rows * B
    const ax0 = c.x + g.col * B * c.scale, ay0 = c.y + g.row * B * c.scale
    const left = clamp(ax0, 30, Math.max(30, sz.w - 30 - (w <= sz.w - 60 ? w : B)))
    const top = clamp(ay0, 100, Math.max(100, sz.h - 90 - (h <= sz.h - 190 ? h : B)))
    live.current.gp = 0
    setGp(0)
    tweenGroup(1, { x: left - g.col * B, y: top - g.row * B, scale: 1 })
  }
  const closeGroup = () => {
    if (openGroup === undefined) return
    tweenGroup(0, groupReturn.current, () => { setOpenGroup(undefined); groupReturn.current = undefined })
  }
  /** 不要动画、立刻收起（切换轴测、分组被删）。 */
  const dropGroup = () => { setOpenGroup(undefined); live.current.gp = 0; setGp(0); groupReturn.current = undefined }

  // 进入笔记或阅读时回到平面，出来再回到轴测（分组保持展开）
  const isoTarget = (on: boolean) => (on && selected === undefined ? 1 : 0)
  // 打开 / 关上阅览室：这一格在网格里展开，镜头移过去（scale 回到 1）；关上时回到原来的镜头（原型 openCell / roomCamera）
  useEffect(() => {
    const p = live.current.proj
    const target = { amount: isoTarget(live.current.iso), spread: live.current.iso ? 1 : 0, open: selected !== undefined ? 1 : 0 }
    let toCam: Camera | undefined
    const sel = selected !== undefined ? cells.find(c => c.id === selected) : undefined
    if (sel !== undefined && live.current.cam !== undefined) {
      if (p.open < 0.001) beforeRoom.current = live.current.cam
      lastRoom.current = sel.id
      const r = roomSize(size, chatOpen, roomMode)
      const w = worldCellRef.current(sel)
      const left = r.beside ? 20 + CHAT_W + 16 + (size.w - 40 - CHAT_W - 16 - r.w) / 2 : (size.w - r.w) / 2
      toCam = { scale: 1, x: left - w.col * B, y: (size.h - r.h) / 2 + 10 - w.row * B }
    } else if (p.open > 0.001) {
      toCam = beforeRoom.current
    }
    const same = Math.abs(p.amount - target.amount) < 0.001 && Math.abs(p.open - target.open) < 0.001 && Math.abs(p.spread - target.spread) < 0.001
    if (!same || toCam !== undefined) animate(target, toCam)
  }, [selected, roomMode, chatOpen, size.w, size.h]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 点图标「读」：EPUB 在这一格里打开；PDF、视频交给系统程序。 */
  const read = (id: string) => {
    if (summaries[id]?.source === 'epub') { setOrbChat(undefined); setRoomMode('reader'); setSelected(id) } else setReading(id)
  }
  const closeRoom = () => { setSelected(undefined); setRoomMode('notes'); setOrbChat(undefined) }

  const toggleIso = () => {
    if (palace === undefined || cam === undefined) return
    const next = !iso
    localStorage.setItem(VIEW_KEY, next ? 'iso' : 'flat')
    setIso(next)
    live.current.iso = next
    dropGroup()
    if (next) flatCam.current = cam
    animate({ amount: isoTarget(next), spread: next ? 1 : 0, open: live.current.proj.open }, next ? spreadCamera(layout, cells, size) : (flatCam.current ?? fitCamera(cells, size)))
  }

  // I 键切换（在输入框、对话里打字时不算）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'i' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      // 全屏和右侧栏可能各有一个宫殿：只切鼠标所在 / 有焦点的那个
      const root = rootRef.current
      if (root === null || !(root.matches(':hover') || root.contains(document.activeElement))) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .mp-chat, .mp-dialog, .mp-sheet')) return
      e.preventDefault()
      toggleIso()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 打开的分组或选中的格子被删了（比如 AI 删的），就收起
  useEffect(() => {
    if (openGroup !== undefined && !cells.some(c => c.id === openGroup)) dropGroup()
    if (selected !== undefined && !cells.some(c => c.id === selected)) setSelected(undefined)
  }, [cells, openGroup, selected])

  useEffect(() => {
    if (opError === undefined) return
    const t = setTimeout(() => setOpError(undefined), 4000)
    return () => clearTimeout(t)
  }, [opError])

  const run = (op: string, args: Record<string, unknown>) => palaceOp(op, args).catch((e: Error) => setOpError(e.message))

  // ---------- 镜头 ----------

  const zoomAt = (factor: number, px: number, py: number) => setCam((c) => {
    if (c === undefined) return c
    const { m, size } = live.current
    const { x: sx, y: sy } = unproject(m, px, py, size.w, size.h)
    const scale = clamp(c.scale * factor, MIN_SCALE, MAX_SCALE)
    const r = scale / c.scale
    return { scale, x: sx - (sx - c.x) * r, y: sy - (sy - c.y) * r }
  })

  useEffect(() => {
    const el = rootRef.current
    if (el === null) return
    // 触控板：双指滑动 = 平移，捏合（浏览器报为 ctrl + wheel）= 缩放；鼠标滚轮 + ⌘ 也是缩放
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.mp-room, .mp-dialog, .mp-chat')) return
      e.preventDefault()
      if (live.current.proj.open > 0.001) return // 阅览室开着：画布不动
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
      else {
        const d = delta(live.current.m, e.deltaX, e.deltaY)
        setCam(c => (c === undefined ? c : { ...c, x: c.x - d.x, y: c.y - d.y }))
      }
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
    // 阅览室开着：点外面 = 关上；阅读时点书外面先回到笔记（原型「阅读器外短点击回到卡片」）
    if (selected !== undefined) {
      if (orbChat !== undefined) setOrbChat(undefined)
      else if (roomMode === 'reader') setRoomMode('notes')
      else closeRoom()
      return
    }
    if (orbChat !== undefined) { setOrbChat(undefined); return }
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
      const d = delta(m, p.x - gesture.sx, p.y - gesture.sy)
      if (moved) setCam({ ...gesture.cam, x: gesture.cam.x + d.x, y: gesture.cam.y + d.y })
      if (moved !== gesture.moved) setGesture({ ...gesture, moved })
    } else {
      setGesture({ ...gesture, moved, px: p.x, py: p.y })
    }
  }

  const onUp = (e: RPointerEvent) => {
    if (gesture === undefined || e.pointerId !== gesture.id) return
    setGesture(undefined)
    // 用松手的位置再判断一次（移动事件来得太快、还没重新渲染时，gesture 里的状态可能是旧的）
    const up = local(e)
    if (!gesture.moved && Math.hypot(up.x - gesture.sx, up.y - gesture.sy) > DRAG_THRESHOLD) gesture.moved = true
    if (gesture.kind === 'cell') { gesture.px = up.x; gesture.py = up.y }
    if (gesture.kind === 'pan') {
      // 在空白处点一下：先收起详情，再收起分组
      if (!gesture.moved) {
        if (selected !== undefined) closeRoom()
        else closeGroup()
      }
      return
    }
    const { cell } = gesture
    if (!gesture.moved) {
      // 轴测视图里分组本来就是展开的
      if (cell.kind === 'group') { if (!spreading && openGroup !== cell.id) enterGroup(cell) } else { setOrbChat(undefined); setSelected(cell.id) } // 首页的光球对话先收起，不和「与书对话」同时出现（#66）
      return
    }
    const target = dropAt({ x: gesture.px, y: gesture.py })?.target
    if (target === undefined) return
    if (target.parentId === cell.parentId && target.col === cell.col && target.row === cell.row) return
    // 最外层：把书 / 笔记拖到一个分组上 = 放进这个分组
    const onto = cells.find(c => c.parentId === target.parentId && c.col === target.col && c.row === target.row)
    if (onto?.kind === 'group' && cell.kind !== 'group' && target.parentId === null) {
      void run('moveCell', { id: cell.id, parentId: onto.id })
      return
    }
    // 最外层：两个独立的格子拖到重叠 = 新建分组，然后给它起名（#40）
    if (onto !== undefined && onto.kind !== 'group' && cell.kind !== 'group' && target.parentId === null && onto.id !== cell.id) {
      void palaceOp<Cell>('groupCells', { id: cell.id, ontoId: onto.id })
        .then(g => setNaming(g)).catch((e: Error) => setOpError(e.message))
      return
    }
    void run('moveCell', { id: cell.id, ...target })
  }

  // ---------- 渲染 ----------

  const dragging = gesture?.kind === 'cell' && gesture.moved ? gesture : undefined
  const group = openGroup !== undefined ? cells.find(c => c.id === openGroup) : undefined
  /** 所有分组原地展开中（轴测视图）。 */
  const spreading = proj.spread > 0.001 && group === undefined
  const arcs = useArcs(iso)

  /** 格子显示在哪一格（世界网格坐标，过渡中是小数）。 */
  const worldCell = (c: Cell): { col: number; row: number } => {
    if (spreading) {
      const e = layout.entries.get(c.id)
      if (e !== undefined) {
        const from = c.parentId !== null ? e.origin : c, t = proj.spread
        return { col: from.col + (e.col - from.col) * t, row: from.row + (e.row - from.row) * t }
      }
    }
    if (c.parentId !== null && group !== undefined && c.parentId === group.id) return { col: group.col + c.col, row: group.row + c.row }
    return { col: c.col, row: c.row }
  }
  const worldCellRef = useRef(worldCell)
  worldCellRef.current = worldCell

  // 阅览室展开时，它右边和下面的网格整体让开（原型 axisCoord）：第 i 条线的世界坐标
  const roomCell = (selected ?? lastRoom.current) !== undefined && proj.open > 0.001 ? cells.find(c => c.id === (selected ?? lastRoom.current)) : undefined
  const roomAt = roomCell !== undefined ? worldCell(roomCell) : undefined
  const rsize = roomSize(size, chatOpen, roomMode)
  const ax = (i: number, axis: 'col' | 'row'): number => {
    if (roomAt === undefined) return i * B
    const at = axis === 'col' ? roomAt.col : roomAt.row
    const extra = ((axis === 'col' ? rsize.w : rsize.h) - B) * proj.open
    return i * B + (i > at + 0.001 ? extra : 0)
  }

  /** 世界坐标里的矩形 → 屏幕上的样式（一个 matrix 同时完成缩放、平移和投影）。 */
  const rect = (x: number, y: number, w: number, h: number): CSSProperties => {
    if (cam === undefined) return { display: 'none' }
    const p = project(m, cam.x + x * cam.scale, cam.y + y * cam.scale, size.w, size.h), s = cam.scale
    return { left: 0, top: 0, width: w, height: h, transform: `matrix(${m.a * s},${m.b * s},${m.c * s},${m.d * s},${p.x},${p.y})` }
  }

  /** 屏幕上一点松手：放到哪（存储位置），提示框画在哪（显示位置）。 */
  const dropAt = (pt: { x: number; y: number }): { target: { parentId: string | null; col: number; row: number }; shown: { col: number; row: number } } | undefined => {
    if (cam === undefined) return undefined
    const u = unproject(m, pt.x, pt.y, size.w, size.h)
    const tile = { col: Math.floor((u.x - cam.x) / cam.scale / B), row: Math.floor((u.y - cam.y) / cam.scale / B) }
    if (spreading) return proj.spread > 0.999 ? { target: spreadDrop(layout, cells, tile), shown: tile } : undefined
    const target = dropTarget(cells, openGroup, tile, true)
    return { target, shown: target.parentId === null || group === undefined ? tile : { col: group.col + target.col, row: group.row + target.row } }
  }
  const gsize = group !== undefined ? groupSize(cells, group.id, dragging !== undefined) : undefined
  const roots = cells.filter(c => c.parentId === null)
  const children = group !== undefined ? cells.filter(c => c.parentId === group.id) : []
  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) if (c.parentId !== null) m.set(c.parentId, (m.get(c.parentId) ?? 0) + 1)
    return m
  }, [cells])
  // 分组的进度环：组里每一格都有进度时取平均（原型 updateMoon）
  const groupPercent = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of cells.filter(c => c.kind === 'group')) {
      const ps = cells.filter(c => c.parentId === g.id).map(c => summaries[c.id]?.percent)
      if (ps.length > 0 && ps.every(p => p !== undefined)) m.set(g.id, (ps as number[]).reduce((a, b) => a + b, 0) / ps.length)
    }
    return m
  }, [cells, summaries])

  // 分组展开后，被框盖住的最外层格子先不画（避免透出来）
  const covered = (c: Cell) => group !== undefined && gsize !== undefined
    && c.col >= group.col && c.col < group.col + gsize.cols && c.row >= group.row && c.row < group.row + gsize.rows
  const drop = dragging !== undefined ? dropAt({ x: dragging.px, y: dragging.py }) : undefined

  const renderCell = (c: Cell) => {
    const isDragged = dragging?.cell.id === c.id
    const w = worldCell(c)
    let x = ax(w.col, 'col'), y = ax(w.row, 'row')
    if (isDragged && cam !== undefined) {
      const d = delta(m, dragging.px - dragging.sx, dragging.py - dragging.sy)
      x += d.x / cam.scale
      y += d.y / cam.scale
    }
    return (
      <div key={c.id} className={`mp-cell mp-${c.kind} ${isDragged ? 'mp-lifted' : ''} ${selected === c.id ? 'mp-selected' : ''}`}
        style={{ ...rect(x, y, B, B), opacity: (spreading && c.parentId !== null ? proj.spread : 1) * (1 - proj.open), pointerEvents: proj.open > 0.001 ? 'none' : undefined }}
        onPointerEnter={() => setHover(c.id)} onPointerLeave={() => setHover(h => (h === c.id ? undefined : h))}
        onPointerDown={e => onCellDown(e, c)}>
        <CellFace cell={c} summary={summaries[c.id]} count={childCount.get(c.id) ?? 0} groupPercent={groupPercent.get(c.id)} onRead={() => read(c.id)} />
      </div>
    )
  }

  // 光球：宫殿里（平面、没开阅览室）或阅读时出现；打开笔记、轴测、拖动、添加时不出现（原型 palaceOrb.update 的 blocked）
  const reader = selected !== undefined && roomMode === 'reader'
  const orbView: OrbView | undefined = (() => {
    if (cam === undefined || palace === undefined || size.w === 0) return undefined
    if (proj.amount > 0.001 || dragging !== undefined || adding || gesture?.kind === 'pan') return undefined
    const exclusions: Rect[] = [{ x: 0, y: 0, w: 280, h: 110 }, { x: size.w - 340, y: size.h - 80, w: 340, h: 80 }]
    if (reader) {
      if (proj.open < 0.999 || roomAt === undefined) return undefined
      const x = cam.x + ax(roomAt.col, 'col') * cam.scale, y = cam.y + ax(roomAt.row, 'row') * cam.scale
      return { width: size.w, height: size.h, x: cam.x, y: cam.y, spacing: B * cam.scale, occupied: [], exclusions: [exclusions[0]], readerRect: { x, y, w: rsize.w * cam.scale, h: rsize.h * cam.scale } }
    }
    if (proj.open > 0.001) return undefined
    const shownCells = group !== undefined ? [...roots.filter(c => !covered(c)), ...children] : roots
    if (group !== undefined && gsize !== undefined) exclusions.push({ x: cam.x + group.col * B * cam.scale, y: cam.y + group.row * B * cam.scale, w: gsize.cols * B * cam.scale, h: gsize.rows * B * cam.scale })
    return { width: size.w, height: size.h, x: cam.x, y: cam.y, spacing: B * cam.scale, occupied: shownCells.map(worldCell), exclusions }
  })()

  // 立起来的图标：抵消投影的旋转和倾斜，正对镜头，抬高并放大（原型 isometric.js 的 update）
  const det = m.a * m.d - m.b * m.c
  const relief = {
    '--mp-facing': `matrix(${m.d / det},${-m.b / det},${-m.c / det},${m.a / det},0,0)`,
    '--mp-lift': `${-19 * proj.amount}px`,
    '--mp-relief-scale': String(1 + 0.8 * proj.amount),
    '--mp-depth': String(proj.amount),
    '--mp-ground-y': `${14.5 * proj.amount}px`,
    '--mp-ground-scale': String(1 + 0.1 * proj.amount),
  } as CSSProperties

  return (
    <div ref={rootRef} className={`mp-root ${gesture?.kind === 'pan' && gesture.moved ? 'mp-panning' : ''} ${chatOpen ? 'mp-chatting' : ''} ${proj.amount > 0.999 ? 'mp-iso' : ''}`}
      style={{ ...lightScheme(), ...relief }}
      onPointerDown={onBackgroundDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setGesture(undefined)}>
      <div className="mp-paper" />
      <svg className="mp-defs" aria-hidden="true"><defs>
        {/* 进度环的水彩边（原型 #watercolor-ring） */}
        <filter id="mp-watercolor-ring" x="-35%" y="-35%" width="170%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="2" seed="11" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.8" />
          <feGaussianBlur stdDeviation=".45" />
        </filter>
      </defs></svg>
      {cam !== undefined && <Grid cam={cam} size={size} m={m} ax={ax} />}

      {spreading && [...layout.frames.values()].map((e) => {
        const p = worldCell(e.cell), t = proj.spread
        return <div key={e.cell.id} className="mp-iso-folder" style={{ ...rect(p.col * B, p.row * B, (1 + (e.w - 1) * t) * B, (1 + (e.h - 1) * t) * B), opacity: t * (1 - proj.open) }} />
      })}
      {spreading && cam !== undefined && proj.amount > 0.001 && (
        <Arcs arcs={arcs} cells={cells} hover={hover} amount={proj.amount} m={m} cam={cam} size={size} B={B} worldCell={worldCell} />
      )}

      {spreading
        ? cells.map(c => renderCell(c))
        : roots.filter(c => !covered(c)).map(c => renderCell(c))}

      {group !== undefined && gsize !== undefined && cam !== undefined && (
        <>
          {/* 阅览室展开时分组框和遮罩跟格子一起淡出，关上后回到原来的分组 */}
          <div className="mp-dim" style={{ opacity: gp * (1 - proj.open) }} />
          <div className="mp-group-frame" style={{ ...rect(group.col * B, group.row * B, B + (gsize.cols - 1) * B * gp, B + (gsize.rows - 1) * B * gp), opacity: 1 - proj.open }} />
          {gp > 0.6 && children.map(c => renderCell(c))}
        </>
      )}

      {drop !== undefined && <div className="mp-drop" style={rect(drop.shown.col * B, drop.shown.row * B, B, B)} />}

      <header className="mp-masthead">
        <span className="mp-wordmark">Memory Palace</span>
        {selected !== undefined && <button type="button" className="mp-back" aria-label={roomMode === 'reader' ? '回到笔记' : '回到宫殿'} onPointerDown={e => e.stopPropagation()} onClick={() => (roomMode === 'reader' ? setRoomMode('notes') : closeRoom())}><span /></button>}
        {group !== undefined && selected === undefined && proj.open < 0.001 && <GroupBar group={group} empty={children.length === 0} onBack={closeGroup} onError={setOpError} />}
      </header>

      {palace !== undefined && cells.length === 0 && (
        <div className="mp-empty">宫殿还是空的。点右下角的 ＋ 放进第一本书，或者写一条笔记。</div>
      )}
      {(error ?? opError) && <div className="mp-toast">{opError ?? `加载失败：${error}`}</div>}

      <footer className="mp-footer" hidden={proj.open > 0.001} onPointerDown={e => e.stopPropagation()}>
        <button type="button" className="mp-round" title="添加" onClick={() => setAdding(true)}>＋</button>
        <button type="button" className="mp-view-toggle" aria-pressed={iso} aria-keyshortcuts="I" title={iso ? '切换到平面视图（I）' : '切换到轴测视图（I）：看分组和书之间的电弧'} onClick={toggleIso}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 6-10 6L2 9Z M2 13l10 6 10-6 M2 17l10 6 10-6" /></svg>
          <span>{iso ? '平面' : '轴测'}</span>
        </button>
        {/* 光球没地方放（窗口太小、格子太密）时的备用入口 */}
        {!orbShown && <button type="button" className="mp-round mp-ai-orb" title="和宫殿对话（真实的 Harness 对话）" onClick={e => { const r = e.currentTarget.getBoundingClientRect(), b = rootRef.current!.getBoundingClientRect(); setOrbChat({ x: r.left - b.left - 120, y: Math.max(95, size.h - ORB_CHAT.h - 90), w: r.width, h: 0 }) }}>AI</button>}
        <div className="mp-zoom">
          <button type="button" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} disabled={(cam?.scale ?? 1) <= MIN_SCALE + 0.001}>−</button>
          <button type="button" className="mp-zoom-reset" title="显示全部" onClick={() => palace && setCam(iso ? spreadCamera(layout, palace.cells, size) : fitCamera(palace.cells, size))}>{Math.round((cam?.scale ?? 1) * 100)}%</button>
          <button type="button" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)} disabled={(cam?.scale ?? 1) >= MAX_SCALE - 0.001}>＋</button>
        </div>
      </footer>

      {roomCell !== undefined && roomAt !== undefined && palace !== undefined && cam !== undefined && (() => {
        const x = ax(roomAt.col, 'col'), y = ax(roomAt.row, 'row')
        const w = ax(roomAt.col + 1, 'col') - x, h = ax(roomAt.row + 1, 'row') - y
        const shown = selected === roomCell.id
        // 阅览室在屏幕上的位置（这时已经是平面）：对话面板贴在它左边
        const sx = cam.x + x * cam.scale, sy = cam.y + y * cam.scale
        return (
          <>
            <div className={`mp-room ${roomMode === 'reader' ? 'mp-room-reader' : ''}`} style={{ ...rect(x, y, w, h), opacity: proj.open }}>
              {proj.open > 0.6 && roomMode === 'notes' && (
                <Room key={roomCell.id} palace={palace} cellId={roomCell.id} summary={summaries[roomCell.id]} tab={tab} onTab={setTab}
                  sessionId={chatOpen && roomSession?.cellId === roomCell.id ? roomSession.sessionId : undefined}
                  onRead={() => read(roomCell.id)} onClose={closeRoom} />
              )}
              {proj.open > 0.6 && roomMode === 'reader' && (
                <RoomReader key={roomCell.id} cell={roomCell} onNotes={() => setRoomMode('notes')}
                  onChat={() => setOrbChat({ x: sx + w * cam.scale - ORB_CHAT.w + 100, y: Math.max(20, sy - ORB_CHAT.h / 2), w: 0, h: 0 })} />
              )}
              {shown && roomMode === 'notes' && !chatOpen && <button type="button" className="mp-room-ai" title="和这本书对话" onPointerDown={e => e.stopPropagation()} onClick={() => setChatOpen(true)}>AI</button>}
            </div>
            {shown && roomMode === 'notes' && <RoomTabs summary={summaries[roomCell.id]} tab={tab} onTab={setTab} style={{ opacity: proj.open, left: sx + w * cam.scale / 2 }} />}
            {shown && roomMode === 'notes' && chatOpen && proj.open > 0.6 && (
              <PalaceChat key={roomCell.id} scope={roomCell.id} itemId={roomCell.id} dock={besideDock(rsize.beside, sx, sy, h * cam.scale, B * cam.scale)}
                onSession={id => setRoomSession(id === undefined ? undefined : { cellId: roomCell.id, sessionId: id })} heading="与书对话" context={`《${roomCell.title}》`} prompts={BOOK_PROMPTS} onClose={() => setChatOpen(false)} />
            )}
          </>
        )
      })()}
      <Orb view={orbView} label={reader ? '打开阅读 AI 对话' : '打开宫殿 AI 对话'} open={orbChat !== undefined} onShown={setOrbShown}
        onToggle={at => setOrbChat(orbChat !== undefined ? undefined : at)} />
      {orbChat !== undefined && palace !== undefined && (() => {
        // 面板在光球下方（原型 positionPanel），放不下就往上挪
        const ch = Math.min(ORB_CHAT.h, size.h - 120), cw = Math.min(ORB_CHAT.w, size.w - 36)
        const dock = { left: clamp(orbChat.x - 100, 18, size.w - cw - 18), top: clamp(orbChat.y + orbChat.h + 18, 20, size.h - ch - 20), width: cw, height: ch }
        return reader && roomCell !== undefined
          ? <PalaceChat key={`orb-${roomCell.id}`} scope={roomCell.id} itemId={roomCell.id} dock={dock} heading="与书对话" context={`《${roomCell.title}》`} prompts={BOOK_PROMPTS}
              onSession={id => setRoomSession(id === undefined ? undefined : { cellId: roomCell.id, sessionId: id })} onClose={() => setOrbChat(undefined)} />
          : <PalaceChat key="orb-palace" scope="palace" dock={dock} heading="与宫殿对话" context="把读过的书，与此刻的想法放在一起。" prompts={PALACE_PROMPTS} onClose={() => setOrbChat(undefined)} />
      })()}
      {reading !== undefined && palace?.cells.some(c => c.id === reading) && (() => {
        const c = palace.cells.find(x => x.id === reading) as Cell
        return <ReadBook key={c.id} id={c.id} title={c.title} subtitle={c.subtitle} onClose={() => setReading(undefined)} onError={setOpError} />
      })()}
      {adding && <AddDialog parentId={group?.id} onClose={() => setAdding(false)} />}
      {naming !== undefined && <GroupNameDialog group={naming} onClose={() => setNaming(undefined)} />}
    </div>
  )
}

/** 阅览室这一格里的阅读器（EPUB）。 */
function RoomReader({ cell, onNotes, onChat }: { cell: Cell; onNotes: () => void; onChat: () => void }) {
  const { item, error } = useItem(cell.id)
  if (item === undefined) return <p className="mp-hint mp-room-loading">{error ? `读取失败：${error}` : '正在打开…'}</p>
  return <EpubReader item={item} title={cell.title} subtitle={cell.subtitle} onClose={onNotes} embedded={{ onNotes, onChat }} />
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

/** 拖动松手时落在哪一格（平面视图，tile 是世界网格坐标）。分组展开时，落在框里 = 组内坐标，落在框外 = 最外层。 */
function dropTarget(cells: Cell[], openGroup: string | undefined, tile: { col: number; row: number }, spare: boolean): { parentId: string | null; col: number; row: number } {
  const { col, row } = tile
  const group = openGroup !== undefined ? cells.find(c => c.id === openGroup) : undefined
  if (group !== undefined) {
    const { cols, rows } = groupSize(cells, group.id, spare)
    const gc = col - group.col, gr = row - group.row
    if (gc >= 0 && gr >= 0 && gc < cols && gr < rows) return { parentId: group.id, col: gc, row: gr }
  }
  return { parentId: null, col, row }
}

/**
 * 格子正面（移植自原型的 .cell，规则见 Discussion #37）：左上角不放东西；右上角水彩图标，百分比在图标下面；
 * 左下角大字标题最多两行，上面一行小字（备注：作者、中文名……用户想填什么都行）；右边竖排阅读起止时间。
 */
function CellFace({ cell, summary, count, groupPercent, onRead }: { cell: Cell; summary?: CellSummary; count: number; groupPercent?: number; onRead: () => void }) {
  const readable = summary?.source !== undefined
  const percent = cell.kind === 'group' ? groupPercent : summary?.percent
  // 右边竖排：阅读起止月份，如 2026.11-now、2026.11-2026.12（原型 formatPeriod）
  const p = summary?.period
  const period = p === undefined ? undefined : `${p.start.replace('-', '.')}-${p.end !== undefined ? p.end.replace('-', '.') : 'now'}`
  return (
    <>
      <Moon icon={iconOf(cell)} percent={percent}
        label={readable ? `阅读《${cell.title}》${percent !== undefined ? ` · 已读 ${percentText(percent)}` : ''}` : cell.title}
        onOpen={readable ? onRead : undefined} />
      {cell.kind === 'group' && <span className="mp-group-count">{count} 项</span>}
      <span className="mp-cell-title">
        {cell.subtitle !== undefined && <span className="mp-cell-sub" title={cell.subtitle}>{cell.subtitle}</span>}
        <span className="mp-cell-main" title={cell.title}>{cell.title}</span>
      </span>
      {period !== undefined && <span className="mp-period">{period}</span>}
    </>
  )
}

/** 网格线和交点（随投影一起变形；阅览室展开时线跟着让开）。只画视野里的部分。移植自原型 isometric.js 的 grid()。 */
function Grid({ cam, size, m, ax }: { cam: Camera; size: Size; m: Matrix; ax: (i: number, axis: 'col' | 'row') => number }) {
  const corners = [[0, 0], [size.w, 0], [0, size.h], [size.w, size.h]].map(([x, y]) => unproject(m, x, y, size.w, size.h))
  const step = B * cam.scale
  // 阅览室让开的那段宽度也算进去，多画几条线
  const extraX = Math.ceil((ax(1e6, 'col') - 1e6 * B) / B), extraY = Math.ceil((ax(1e6, 'row') - 1e6 * B) / B)
  const minX = Math.floor((Math.min(...corners.map(p => p.x)) - cam.x) / step) - 1 - extraX
  const maxX = Math.ceil((Math.max(...corners.map(p => p.x)) - cam.x) / step) + 1
  const minY = Math.floor((Math.min(...corners.map(p => p.y)) - cam.y) / step) - 1 - extraY
  const maxY = Math.ceil((Math.max(...corners.map(p => p.y)) - cam.y) / step) + 1
  const pt = (i: number, j: number) => project(m, cam.x + ax(i, 'col') * cam.scale, cam.y + ax(j, 'row') * cam.scale, size.w, size.h)
  const lines: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
  const dots: { x: number; y: number }[] = []
  for (let i = minX; i <= maxX; i++) {
    lines.push({ a: pt(i, minY), b: pt(i, maxY) })
    for (let j = minY; j <= maxY; j++) {
      const p = pt(i, j)
      if (p.x >= -5 && p.x <= size.w + 5 && p.y >= -5 && p.y <= size.h + 5) dots.push(p)
    }
  }
  for (let j = minY; j <= maxY; j++) lines.push({ a: pt(minX, j), b: pt(maxX, j) })
  const r = clamp(3.1 * Math.sqrt(cam.scale), 1.8, 4.2)
  return (
    <svg className="mp-grid" width={size.w} height={size.h}>
      <g className="mp-lines">
        {lines.map((l, i) => <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} />)}
      </g>
      <g className="mp-dots">
        {dots.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={r} />)}
      </g>
    </svg>
  )
}
