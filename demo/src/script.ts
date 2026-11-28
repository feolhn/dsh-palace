/**
 * 演示台本的数据结构和纯计算（#107）。没有 DOM，单测在 test/demo.test.mjs。
 *
 * - 台本按「幕」拆开，每一幕是一串动作，只写「顺序 + 时长」，不写绝对时刻。
 * - 每个动作本质是一次状态变化（apply 是纯函数），动画只是界面对变化的反应。
 *   所以「跳到第 N 幕」= 从开场状态把前面的动作瞬间重放一遍；台本里不能有随机。
 * - 演新功能就加一种动作：在 Action 里加一项，在 apply 里写它怎么改状态。
 */
import { emptyItem, type Cell, type Item } from '../../src/shared/palace.ts'

export interface DemoArc { from: string; to: string; why: string }
export interface Line { who: 'user' | 'ai'; text: string }

/** 播放器管的全部状态：宫殿数据（交给假接口）+ 视图、字幕、对话（交给演示自己的界面）。 */
export interface DemoState {
  cells: Cell[]
  items: Record<string, Item>
  arcs: DemoArc[]
  iso: boolean
  caption?: string
  chat: Line[]
}

export interface NewCell {
  id: string
  title: string
  kind?: 'note' | 'book'
  subtitle?: string
  icon?: string
  col: number
  row: number
  /** 0–1：书的进度（演示用，按节数换算） */
  progress?: number
}

export type Action =
  | { do: 'caption'; text: string; ms?: number }
  | { do: 'view'; iso: boolean; ms?: number }
  | { do: 'addCell'; cell: NewCell; ms?: number }
  | { do: 'say'; who: 'user' | 'ai'; text: string; ms?: number }
  | { do: 'arc'; from: string; to: string; why: string; ms?: number }
  | { do: 'wait'; ms: number }

export interface Scene {
  id: string
  /** 进度条上的名字 */
  title: string
  actions: Action[]
}

const CREATED = '2026-11-01T00:00:00.000Z'

function cellOf(c: NewCell): { cell: Cell; item: Item } {
  const kind = c.kind ?? 'note'
  const cell: Cell = { id: c.id, kind, parentId: null, col: c.col, row: c.row, title: c.title, createdAt: CREATED,
    ...(c.subtitle !== undefined ? { subtitle: c.subtitle } : {}), ...(c.icon !== undefined ? { icon: c.icon } : {}) }
  const item = emptyItem(c.id, kind === 'book' ? { type: 'epub', path: '' } : null)
  if (c.progress !== undefined) {
    // 十节，按进度勾上前几节，格子上就有进度环
    const done = Math.round(c.progress * 10)
    item.chapters = [{ id: `${c.id}-ch`, title: '目录', sections: Array.from({ length: 10 }, (_, i) => ({ id: `${c.id}-s${i}`, title: `第 ${i + 1} 节`, done: i < done })) }]
  }
  return { cell, item }
}

/** 一个动作对状态的改变（不改入参）。 */
export function apply(s: DemoState, a: Action): DemoState {
  switch (a.do) {
    case 'caption': return { ...s, caption: a.text }
    case 'view': return { ...s, iso: a.iso }
    case 'addCell': {
      const { cell, item } = cellOf(a.cell)
      return { ...s, cells: [...s.cells.filter(c => c.id !== cell.id), cell], items: { ...s.items, [cell.id]: item } }
    }
    case 'say': return { ...s, chat: [...s.chat, { who: a.who, text: a.text }] }
    case 'arc': return { ...s, arcs: [...s.arcs, { from: a.from, to: a.to, why: a.why }] }
    case 'wait': return s
  }
}

/** 每一幕开始时清掉上一幕的字幕和对话，宫殿和视图留着。 */
export const enterScene = (s: DemoState): DemoState => ({ ...s, caption: undefined, chat: [] })

/** 停留时长：字幕和对话按字数算（看得完），其他动作留给界面动画。台本里写了 ms 就用台本的。 */
export function durationOf(a: Action): number {
  if (a.ms !== undefined) return a.ms
  if (a.do === 'caption' || a.do === 'say') return 1200 + 110 * [...a.text].length
  if (a.do === 'view') return 1600
  return 900
}

export const sceneLength = (scene: Scene) => scene.actions.reduce((t, a) => t + durationOf(a), 0)

/** 第 index 幕开始时的状态：开场状态 + 前面所有幕瞬间重放。 */
export function stateAt(start: DemoState, scenes: Scene[], index: number): DemoState {
  let s = start
  for (const scene of scenes.slice(0, index)) {
    s = enterScene(s)
    for (const a of scene.actions) s = apply(s, a)
  }
  return enterScene(s)
}

export function startState(cells: NewCell[], iso: boolean): DemoState {
  let s: DemoState = { cells: [], items: {}, arcs: [], iso, chat: [] }
  for (const cell of cells) s = apply(s, { do: 'addCell', cell })
  return s
}
