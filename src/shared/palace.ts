/**
 * v0.2 数据模型（前后端共用）。说明见 docs/CONTRACT.md §2–§3。
 * 改字段 = 改契约：先改文档，再改这里。
 *
 * 存储层会原样保留认不出的字段，所以这里的类型只列出我们认识的部分。
 */

export const SCHEMA = 2

// ---------- 宫殿 ----------

/** book：有原文；note：没有原文；group：分组（只能在最外层）。 */
export type CellKind = 'book' | 'note' | 'group'

export interface Cell {
  id: string
  kind: CellKind
  /** null = 宫殿最外层；否则是所在分组的 id。 */
  parentId: string | null
  /** 整数坐标。最外层可以为负；分组里从 0 开始。 */
  col: number
  row: number
  title: string
  subtitle?: string
  /** 水彩图标（vendor/icons/<icon>.webp）。不填时按 id 挑一个固定的。 */
  icon?: string
  createdAt: string
}

export interface Palace {
  schema: typeof SCHEMA
  cells: Cell[]
}

export function emptyPalace(): Palace {
  return { schema: SCHEMA, cells: [] }
}

// ---------- 格子内容 ----------

export type SourceRef =
  | { type: 'pdf'; path: string; pageCount: number }
  | { type: 'epub'; path: string }
  | { type: 'video'; url: string }

export type SourceType = SourceRef['type']

/** 节：进度计数的最小单位。 */
export interface Section {
  id: string
  title: string
  /** 原文位置，只有对应的 source / reader 认识（pdf 是页码，epub 是 CFI 或 href，video 是这一集的链接）。 */
  loc?: string
  done: boolean
  doneAt?: string
}

export interface Chapter {
  id: string
  title: string
  sections: Section[]
}

export type CardType = 'excerpt' | 'thought' | 'mistake'
export type MistakeStatus = 'todo' | 'mastered'

export interface Card {
  id: string
  type: CardType
  sectionId?: string
  loc?: string
  /** 原文或题目。thought 没有。 */
  quote?: string
  /** 我的想法 / 批注 / 错因。 */
  note?: string
  /** 只有 mistake。 */
  answer?: string
  /** 只有 mistake。 */
  status?: MistakeStatus
  /** 原图文件名，相对 images/。 */
  image?: string
  createdAt: string
  /** 分享卡片的排版草稿，由 share 模块定义，core 原样保存。 */
  share?: unknown
}

export interface Inspiration {
  id: string
  title: string
  /** Markdown 正文。 */
  body: string
  sessionId?: string
  cardIds?: string[]
  createdAt: string
}

export interface Item {
  schema: typeof SCHEMA
  /** 等于格子 id。 */
  id: string
  source: SourceRef | null
  targetDate?: string
  finishedAt?: string
  outlineSource?: 'bookmarks' | 'toc' | 'ai' | 'video' | 'manual'
  chapters: Chapter[]
  position?: { loc: string; percent: number }
  cards: Card[]
  inspirations: Inspiration[]
}

export function emptyItem(id: string, source: SourceRef | null = null): Item {
  return { schema: SCHEMA, id, source, chapters: [], cards: [], inspirations: [] }
}

// ---------- 进度计算（纯函数，前后端一致） ----------

export interface Progress {
  done: number
  total: number
  /** 第一个未完成的节，即「当前在学」。 */
  current?: { chapter: Chapter; section: Section }
}

export function progressOf(item: Pick<Item, 'chapters'>): Progress {
  let done = 0
  let total = 0
  let current: Progress['current']
  for (const chapter of item.chapters) {
    for (const section of chapter.sections) {
      total += 1
      if (section.done) done += 1
      else if (current === undefined) current = { chapter, section }
    }
  }
  return { done, total, current }
}

export interface Pace {
  remaining: number
  /** 含今天在内剩余天数；已过期为 0 或负数。 */
  daysLeft: number
  /** 每天需要完成的节数（向上取一位小数）。 */
  perDay?: number
  overdue: boolean
}

/** 按目标日期倒推节奏：剩 N 节、每天约 M 节。没有目标日期返回 undefined。 */
export function paceOf(item: Pick<Item, 'chapters' | 'targetDate'>, now = today()): Pace | undefined {
  if (item.targetDate === undefined) return undefined
  const { done, total } = progressOf(item)
  const remaining = total - done
  const daysLeft = daysBetween(now, item.targetDate) + 1
  if (daysLeft <= 0) return { remaining, daysLeft, overdue: remaining > 0 }
  const perDay = remaining === 0 ? 0 : Math.ceil((remaining / daysLeft) * 10) / 10
  return { remaining, daysLeft, perDay, overdue: false }
}

/** 画布上每个格子显示的进度摘要，避免画布读取全部 item。 */
export interface CellSummary {
  done: number
  total: number
  perDay?: number
  overdue?: boolean
  cards: number
  finished: boolean
  /** 原文类型；笔记格子没有。 */
  source?: SourceType
  /** 目标日期（YYYY-MM-DD）。 */
  targetDate?: string
  /** 0–1 的阅读进度：读完是 1；EPUB 用阅读位置，其他按打勾的节；没法算就没有。 */
  percent?: number
}

export function summaryOf(item: Item, now = today()): CellSummary {
  const { done, total } = progressOf(item)
  const pace = paceOf(item, now)
  return {
    done, total,
    ...(pace?.perDay !== undefined ? { perDay: pace.perDay } : {}),
    ...(pace?.overdue ? { overdue: true } : {}),
    cards: item.cards.length,
    finished: item.finishedAt !== undefined,
    ...(item.source !== null ? { source: item.source.type } : {}),
    ...(item.targetDate ? { targetDate: item.targetDate } : {}),
    ...(percentOf(item, done, total) !== undefined ? { percent: percentOf(item, done, total) } : {}),
  }
}

function percentOf(item: Item, done: number, total: number): number | undefined {
  if (item.finishedAt !== undefined) return 1
  if (item.source?.type === 'epub' && item.position !== undefined) return item.position.percent
  return total > 0 ? done / total : undefined
}

export function findSection(item: Pick<Item, 'chapters'>, sectionId: string | undefined): { chapter: Chapter; section: Section } | undefined {
  if (sectionId === undefined) return undefined
  for (const chapter of item.chapters) {
    const section = chapter.sections.find(s => s.id === sectionId)
    if (section !== undefined) return { chapter, section }
  }
  return undefined
}

// ---------- 日期 ----------

/** 本地日期 YYYY-MM-DD。 */
export function today(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 两个 YYYY-MM-DD 之间相差的天数（b - a）。 */
export function daysBetween(a: string, b: string): number {
  const pa = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const pb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((pb - pa) / 86_400_000)
}

export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
