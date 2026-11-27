/**
 * v0.2 业务操作：宫殿、格子、进度、卡片、灵感。
 * HTTP 接口和 AI 工具都只调这里，规则只有一份。规则说明见 docs/CONTRACT.md §2–§3。
 *
 * 原文（pdf / epub / video）的校验由 sources 模块负责，这里只做基本的形状检查。
 */
import {
  emptyItem, findSection, isDateString,
  type Card, type CardType, type Cell, type CellKind, type Chapter, type Inspiration,
  type Item, type Palace, type Section, type SourceRef,
} from '../shared/palace.ts'
import { assertCellId, newId, nowIso, ShelfError, type PalaceStore, type Tx } from './store.ts'

// ---------- 参数检查 ----------

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ShelfError(`${what}不能为空`)
  return value.trim()
}

function optionalText(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ShelfError(`${what}应为文字`)
  return value.trim() === '' ? undefined : value.trim()
}

function optionalDate(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (!isDateString(value)) throw new ShelfError(`${what}格式应为 YYYY-MM-DD`)
  return value
}

function int(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value)) throw new ShelfError(`${what}应为整数`)
  return value as number
}

/** 可选字段：undefined 不改，null / 空串删除，其他设置。 */
function patch<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined, clear: boolean): void {
  if (clear) delete target[key]
  else if (value !== undefined) target[key] = value
}

function isClear(value: unknown): boolean {
  return value === null || value === ''
}

function cellOf(palace: Palace, id: unknown): Cell {
  assertCellId(id)
  const cell = palace.cells.find(c => c.id === id)
  if (cell === undefined) throw new ShelfError('格子不存在')
  return cell
}

/** 书 / 笔记格子的内容。分组没有内容。 */
function itemOf(tx: Tx, id: unknown): Item {
  const cell = cellOf(tx.palace, id)
  if (cell.kind === 'group') throw new ShelfError('分组没有笔记本')
  return tx.item(cell.id)
}

function sourceOf(value: unknown): SourceRef {
  const v = value as Partial<Record<string, unknown>> | null
  if (v?.type === 'pdf' && typeof v.path === 'string' && Number.isSafeInteger(v.pageCount)) return { type: 'pdf', path: v.path, pageCount: v.pageCount as number }
  if (v?.type === 'epub' && typeof v.path === 'string') return { type: 'epub', path: v.path }
  if (v?.type === 'video' && typeof v.url === 'string') return { type: 'video', url: v.url }
  throw new ShelfError('原文信息无效')
}

// ---------- 坐标 ----------

function occupant(palace: Palace, parentId: string | null, col: number, row: number): Cell | undefined {
  return palace.cells.find(c => c.parentId === parentId && c.col === col && c.row === row)
}

/** 新格子的默认位置：按行从左到右找第一个空位。最外层每行 3 格；分组至少 2 列，满了再变宽。 */
export function firstEmptySlot(palace: Palace, parentId: string | null): { col: number; row: number } {
  const siblings = palace.cells.filter(c => c.parentId === parentId).length
  const width = parentId === null ? 3 : Math.max(2, Math.ceil(Math.sqrt(siblings + 1)))
  for (let i = 0; ; i++) {
    const col = i % width
    const row = Math.floor(i / width)
    if (occupant(palace, parentId, col, row) === undefined) return { col, row }
  }
}

function checkParent(palace: Palace, parentId: unknown, kind: CellKind): string | null {
  if (parentId === undefined || parentId === null) return null
  const parent = cellOf(palace, parentId)
  if (parent.kind !== 'group') throw new ShelfError('只能放进分组里')
  if (kind === 'group') throw new ShelfError('分组里不能再放分组')
  return parent.id
}

function checkPosition(parentId: string | null, col: number, row: number): void {
  if (parentId !== null && (col < 0 || row < 0)) throw new ShelfError('分组里的坐标不能为负')
}

// ---------- 格子 ----------

/** 像手机主屏幕的文件夹：最后一格移出（或删掉）后，原来的分组自动消失。新建的空分组不受影响。 */
function pruneGroup(palace: Palace, groupId: string | null): void {
  if (groupId === null || palace.cells.some(c => c.parentId === groupId)) return
  palace.cells = palace.cells.filter(c => c.id !== groupId)
}

export interface AddCellArgs {
  kind: unknown
  title: unknown
  subtitle?: unknown
  parentId?: unknown
  col?: unknown
  row?: unknown
  /** 只有 book：已经由 sources 模块校验过的原文信息。 */
  source?: unknown
  targetDate?: unknown
  /** 只有 book：初始目录（PDF 书签、视频分 P）。 */
  outline?: OutlineInput[]
  outlineSource?: Item['outlineSource']
}

export async function addCell(store: PalaceStore, args: AddCellArgs): Promise<Cell> {
  const kind = args.kind
  if (kind !== 'book' && kind !== 'note' && kind !== 'group') throw new ShelfError('格子类型应为 book / note / group')
  const title = text(args.title, '标题')
  const subtitle = optionalText(args.subtitle, '备注')
  const source = kind === 'book' ? sourceOf(args.source) : null
  const targetDate = optionalDate(args.targetDate, '目标日期')
  return store.mutate((tx) => {
    const parentId = checkParent(tx.palace, args.parentId, kind)
    let pos: { col: number; row: number }
    if (args.col === undefined && args.row === undefined) pos = firstEmptySlot(tx.palace, parentId)
    else {
      pos = { col: int(args.col, '列'), row: int(args.row, '行') }
      checkPosition(parentId, pos.col, pos.row)
      if (occupant(tx.palace, parentId, pos.col, pos.row) !== undefined) throw new ShelfError('这个位置已经有格子了')
    }
    const cell: Cell = { id: newId('c'), kind, parentId, ...pos, title, ...(subtitle ? { subtitle } : {}), createdAt: nowIso() }
    tx.palace.cells.push(cell)
    if (kind !== 'group') {
      const item = emptyItem(cell.id, source)
      if (targetDate !== undefined) item.targetDate = targetDate
      if (kind === 'book' && args.outline !== undefined) {
        item.chapters = buildChapters(args.outline)
        if (item.chapters.length > 0 && args.outlineSource !== undefined) item.outlineSource = args.outlineSource
      }
      tx.createItem(item)
    }
    return cell
  })
}

export async function updateCell(store: PalaceStore, args: { id: unknown; title?: unknown; subtitle?: unknown; icon?: unknown }): Promise<Cell> {
  const title = args.title === undefined ? undefined : text(args.title, '标题')
  const subtitle = optionalText(args.subtitle, '备注')
  const icon = optionalText(args.icon, '图标')
  if (icon !== undefined && !/^[a-z][a-z0-9-]{0,30}$/.test(icon)) throw new ShelfError('图标名无效')
  return store.mutate((tx) => {
    const cell = cellOf(tx.palace, args.id)
    if (title !== undefined) cell.title = title
    patch(cell, 'subtitle', subtitle, isClear(args.subtitle))
    patch(cell, 'icon', icon, isClear(args.icon))
    return cell
  })
}

/**
 * 移动格子。目标位置有别的格子时两者互换：对方移到这个格子原来的位置（可能跨层），一次写入完成。
 * 不给 col / row：放到目标层的第一个空位（比如拖进分组）。
 */
export async function moveCell(store: PalaceStore, args: { id: unknown; parentId?: unknown; col?: unknown; row?: unknown }): Promise<Cell> {
  const auto = args.col === undefined && args.row === undefined
  let col = auto ? 0 : int(args.col, '列')
  let row = auto ? 0 : int(args.row, '行')
  return store.mutate((tx) => {
    const cell = cellOf(tx.palace, args.id)
    const parentId = checkParent(tx.palace, args.parentId, cell.kind)
    if (parentId === cell.id) throw new ShelfError('不能放进自己里面')
    if (auto) {
      if (cell.parentId === parentId) return cell
      ;({ col, row } = firstEmptySlot(tx.palace, parentId))
    }
    checkPosition(parentId, col, row)
    const before = [cell.parentId]
    const other = occupant(tx.palace, parentId, col, row)
    if (other !== undefined && other.id !== cell.id) {
      before.push(other.parentId)
      if (other.kind === 'group' && cell.parentId !== null) throw new ShelfError('分组不能换进另一个分组里')
      other.parentId = cell.parentId
      other.col = cell.col
      other.row = cell.row
    }
    cell.parentId = parentId
    cell.col = col
    cell.row = row
    for (const g of before) pruneGroup(tx.palace, g)
    return cell
  })
}

/**
 * 拖成组（#40）：把格子 id 拖到最外层的另一个格子 ontoId 上，就在 ontoId 的位置新建一个分组，两格放进去（ontoId 在前）。
 * 两格都不能是分组；一次写入完成。返回新分组，之后由界面弹出命名框。
 */
export async function groupCells(store: PalaceStore, args: { id: unknown; ontoId: unknown; title?: unknown }): Promise<Cell> {
  const title = args.title === undefined ? '新分组' : text(args.title, '标题')
  return store.mutate((tx) => {
    const cell = cellOf(tx.palace, args.id)
    const onto = cellOf(tx.palace, args.ontoId)
    if (cell.id === onto.id) throw new ShelfError('不能和自己组成分组')
    if (cell.kind === 'group' || onto.kind === 'group') throw new ShelfError('分组不能再放进分组')
    if (onto.parentId !== null) throw new ShelfError('只能在最外层拖成分组')
    const group: Cell = { id: newId('c'), kind: 'group', parentId: null, col: onto.col, row: onto.row, title, createdAt: nowIso() }
    tx.palace.cells.push(group)
    onto.parentId = group.id; onto.col = 0; onto.row = 0
    const from = cell.parentId
    cell.parentId = group.id; cell.col = 1; cell.row = 0
    pruneGroup(tx.palace, from)
    return group
  })
}

/** 删除格子。非空的分组不能删；书 / 笔记连同内容和卡片原图一起删，不删 PDF 等原文件。 */
export async function deleteCell(store: PalaceStore, args: { id: unknown }): Promise<void> {
  return store.mutate((tx) => {
    const cell = cellOf(tx.palace, args.id)
    if (cell.kind === 'group') {
      if (tx.palace.cells.some(c => c.parentId === cell.id)) throw new ShelfError('分组里还有格子，先移出去或删掉')
    } else {
      for (const card of tx.item(cell.id).cards) if (card.image) tx.deleteImage(card.image)
      tx.deleteItem(cell.id)
    }
    tx.palace.cells = tx.palace.cells.filter(c => c.id !== cell.id)
    pruneGroup(tx.palace, cell.parentId)
  })
}

// ---------- 格子内容：日期、位置 ----------

export async function updateItem(store: PalaceStore, args: { id: unknown; targetDate?: unknown; finishedAt?: unknown }): Promise<Item> {
  const targetDate = optionalDate(args.targetDate, '目标日期')
  const finishedAt = optionalDate(args.finishedAt, '读完日期')
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    patch(item, 'targetDate', targetDate, isClear(args.targetDate))
    patch(item, 'finishedAt', finishedAt, isClear(args.finishedAt))
    return item
  })
}

/** 阅读器回报的位置。percent 为 0–1，和「读完」无关。 */
export async function setPosition(store: PalaceStore, args: { id: unknown; loc: unknown; percent: unknown }): Promise<void> {
  const loc = text(args.loc, '位置')
  const percent = args.percent
  if (typeof percent !== 'number' || !(percent >= 0 && percent <= 1)) throw new ShelfError('percent 应为 0–1 的小数')
  return store.mutate((tx) => {
    itemOf(tx, args.id).position = { loc, percent }
  })
}

// ---------- 进度 ----------

export interface OutlineInput {
  title: string
  loc?: string
  sections?: (string | { title: string; loc?: string })[]
}

/**
 * 把 {章, 节[]} 输入转成带 id 的目录。没有节的章自动生成同名节。
 * 传入旧目录时，章、节标题都相同的节保留完成状态（重新生成目录不丢进度）。
 */
export function buildChapters(input: readonly OutlineInput[], previous: readonly Chapter[] = []): Chapter[] {
  const oldDone = new Map<string, Section>()
  for (const c of previous) for (const s of c.sections) if (s.done) oldDone.set(`${c.title}\u0000${s.title}`, s)
  const loc = (v: unknown) => (typeof v === 'string' && v !== '' ? { loc: v } : {})
  return input
    .filter(c => typeof c?.title === 'string' && c.title.trim() !== '')
    .map((c): Chapter => {
      const title = c.title.trim()
      const raw = (c.sections ?? [])
        .map(s => (typeof s === 'string' ? { title: s } : s))
        .filter(s => typeof s?.title === 'string' && s.title.trim() !== '')
      const sections = (raw.length > 0 ? raw : [{ title, loc: c.loc }]).map((s): Section => {
        const st = s.title.trim()
        const old = oldDone.get(`${title}\u0000${st}`)
        return {
          id: newId('s'), title: st, ...loc(s.loc),
          done: old !== undefined,
          ...(old?.doneAt !== undefined ? { doneAt: old.doneAt } : {}),
        }
      })
      return { id: newId('ch'), title, sections }
    })
}

export async function setOutline(store: PalaceStore, args: { id: unknown; chapters: unknown; source?: Item['outlineSource'] }): Promise<Item> {
  if (!Array.isArray(args.chapters) || args.chapters.length === 0) throw new ShelfError('目录不能为空')
  const input = args.chapters as OutlineInput[]
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    // 节的 id 会变：按「章标题 + 节标题」把卡片挂回新节，对应的节被删掉了就变为未归类
    const keyOf = (c: Chapter, s: Section) => `${c.title}\u0000${s.title}`
    const oldKey = new Map<string, string>()
    for (const c of item.chapters) for (const s of c.sections) oldKey.set(s.id, keyOf(c, s))
    const chapters = buildChapters(input, item.chapters)
    if (chapters.length === 0) throw new ShelfError('目录不能为空')
    item.chapters = chapters
    const idByKey = new Map<string, string>()
    for (const c of item.chapters) for (const s of c.sections) if (!idByKey.has(keyOf(c, s))) idByKey.set(keyOf(c, s), s.id)
    for (const card of item.cards) {
      if (card.sectionId === undefined) continue
      const next = idByKey.get(oldKey.get(card.sectionId) ?? '')
      if (next !== undefined) card.sectionId = next
      else delete card.sectionId
    }
    if (args.source !== undefined) item.outlineSource = args.source
    return item
  })
}

export async function setSectionDone(store: PalaceStore, args: { id: unknown; sectionId: unknown; done: unknown }): Promise<void> {
  return store.mutate((tx) => {
    const found = findSection(itemOf(tx, args.id), args.sectionId as string)
    if (found === undefined) throw new ShelfError('节不存在')
    found.section.done = args.done === true
    if (found.section.done) found.section.doneAt = nowIso()
    else delete found.section.doneAt
  })
}

/** 「学到这里」：这一节及之前全部完成，之后的全部未完成。 */
export async function markUpTo(store: PalaceStore, args: { id: unknown; sectionId: unknown }): Promise<void> {
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    if (findSection(item, args.sectionId as string) === undefined) throw new ShelfError('节不存在')
    let before = true
    const at = nowIso()
    for (const c of item.chapters) {
      for (const s of c.sections) {
        if (before && !s.done) { s.done = true; s.doneAt = at }
        if (!before && s.done) { s.done = false; delete s.doneAt }
        if (s.id === args.sectionId) before = false
      }
    }
  })
}

export async function resetProgress(store: PalaceStore, args: { id: unknown }): Promise<void> {
  return store.mutate((tx) => {
    for (const c of itemOf(tx, args.id).chapters) for (const s of c.sections) { s.done = false; delete s.doneAt }
  })
}

// ---------- 卡片 ----------

const CARD_TYPES = new Set<CardType>(['excerpt', 'thought', 'mistake'])

export interface CardInput {
  type?: unknown
  sectionId?: unknown
  loc?: unknown
  quote?: unknown
  note?: unknown
  answer?: unknown
  status?: unknown
  image?: unknown
  share?: unknown
}

/** 一张图只属于一张卡片：删卡片时才能放心删图。 */
function checkImageFree(tx: Tx, name: string, cardId: string): void {
  for (const cell of tx.palace.cells) {
    if (cell.kind === 'group') continue
    if (tx.item(cell.id).cards.some(k => k.image === name && k.id !== cardId)) throw new ShelfError('这张图片已经属于另一张卡片')
  }
}

/** 新增和修改之后都要满足：想法有内容，摘录 / 错题有原文或图片。 */
function checkCardContent(card: Card): void {
  if (card.type === 'thought' && card.note === undefined) throw new ShelfError('想法不能为空')
  if (card.type !== 'thought' && card.quote === undefined && card.image === undefined) throw new ShelfError('摘录和错题需要原文或图片')
}

function cardFields(item: Item, input: CardInput, card: Partial<Card>): void {
  if (input.sectionId !== undefined && !isClear(input.sectionId) && findSection(item, input.sectionId as string) === undefined) throw new ShelfError('节不存在')
  if (input.status !== undefined && input.status !== 'todo' && input.status !== 'mastered') throw new ShelfError('状态应为 todo / mastered')
  if (input.image !== undefined && !isClear(input.image) && (typeof input.image !== 'string' || !/^[\w.-]+$/.test(input.image))) throw new ShelfError('图片文件名无效')
  for (const key of ['sectionId', 'loc', 'quote', 'note', 'answer', 'image'] as const) {
    patch(card, key, optionalText(input[key], key), isClear(input[key]))
  }
  if (input.status !== undefined) card.status = input.status as Card['status']
  if (input.share !== undefined) {
    if (input.share === null) delete card.share
    else {
      // 内容由 share 模块定义，这里只防止存进去奇怪的东西
      if (typeof input.share !== 'object' || Array.isArray(input.share)) throw new ShelfError('分享草稿格式不对')
      if (JSON.stringify(input.share).length > 64 * 1024) throw new ShelfError('分享草稿太大')
      card.share = input.share
    }
  }
}

export async function addCard(store: PalaceStore, args: CardInput & { id: unknown }): Promise<Card> {
  const type = args.type as CardType
  if (!CARD_TYPES.has(type)) throw new ShelfError('卡片类型应为 excerpt / thought / mistake')
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    const card: Card = { id: newId('k'), type, createdAt: nowIso() }
    cardFields(item, args, card)
    if (type === 'mistake' && card.status === undefined) card.status = 'todo'
    checkCardContent(card)
    if (card.image !== undefined) checkImageFree(tx, card.image, card.id)
    item.cards.push(card)
    return card
  })
}

export async function updateCard(store: PalaceStore, args: CardInput & { id: unknown; cardId: unknown }): Promise<Card> {
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    const card = item.cards.find(k => k.id === args.cardId)
    if (card === undefined) throw new ShelfError('卡片不存在')
    if (args.type !== undefined) throw new ShelfError('卡片类型不能修改')
    const oldImage = card.image
    cardFields(item, args, card)
    checkCardContent(card)
    if (card.image !== undefined && card.image !== oldImage) checkImageFree(tx, card.image, card.id)
    if (oldImage !== undefined && oldImage !== card.image) tx.deleteImage(oldImage)
    return card
  })
}

export async function deleteCard(store: PalaceStore, args: { id: unknown; cardId: unknown }): Promise<void> {
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    const card = item.cards.find(k => k.id === args.cardId)
    if (card === undefined) throw new ShelfError('卡片不存在')
    if (card.image) tx.deleteImage(card.image)
    item.cards = item.cards.filter(k => k.id !== card.id)
    for (const i of item.inspirations) if (i.cardIds) i.cardIds = i.cardIds.filter(id => id !== card.id)
  })
}

// ---------- 灵感 ----------

export async function addInspiration(store: PalaceStore, args: { id: unknown; title: unknown; body: unknown; sessionId?: unknown; cardIds?: unknown }): Promise<Inspiration> {
  const title = text(args.title, '灵感标题')
  const body = text(args.body, '灵感正文')
  const sessionId = optionalText(args.sessionId, 'sessionId')
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    const cardIds = Array.isArray(args.cardIds) ? args.cardIds.filter(id => item.cards.some(k => k.id === id)) : []
    const insp: Inspiration = { id: newId('i'), title, body, ...(sessionId ? { sessionId } : {}), ...(cardIds.length ? { cardIds } : {}), createdAt: nowIso() }
    item.inspirations.push(insp)
    return insp
  })
}

export async function updateInspiration(store: PalaceStore, args: { id: unknown; inspirationId: unknown; title?: unknown; body?: unknown }): Promise<Inspiration> {
  const title = args.title === undefined ? undefined : text(args.title, '灵感标题')
  const body = args.body === undefined ? undefined : text(args.body, '灵感正文')
  return store.mutate((tx) => {
    const insp = itemOf(tx, args.id).inspirations.find(i => i.id === args.inspirationId)
    if (insp === undefined) throw new ShelfError('灵感不存在')
    if (title !== undefined) insp.title = title
    if (body !== undefined) insp.body = body
    return insp
  })
}

export async function deleteInspiration(store: PalaceStore, args: { id: unknown; inspirationId: unknown }): Promise<void> {
  return store.mutate((tx) => {
    const item = itemOf(tx, args.id)
    if (!item.inspirations.some(i => i.id === args.inspirationId)) throw new ShelfError('灵感不存在')
    item.inspirations = item.inspirations.filter(i => i.id !== args.inspirationId)
  })
}
