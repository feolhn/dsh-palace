/**
 * v0.2 存储：palace.json（宫殿布局）+ items/<id>.json（每个格子的内容）+ images/。
 * 规则见 docs/CONTRACT.md §1：
 * - 所有修改走 mutate()，串行执行；每个文件原子写入（先写临时文件再改名）
 * - 用户手改了文件：按修改时间和大小重新读；解析失败就继续用内存里的版本，并拒绝写入，不覆盖用户的文件
 * - 认不出的字段原样保留（读进来的对象直接修改，不重建）
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyItem, emptyPalace, SCHEMA, summaryOf, type CellSummary, type Item, type Palace } from '../shared/palace.ts'

/** 用户可读的业务错误（路由返回 400，工具把 message 返回给 AI）。 */
export class ShelfError extends Error {}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

const CELL_ID = /^c_[0-9a-f]{10}$/
const KINDS = new Set(['book', 'note', 'group'])

/** 格子 id 也是文件名，必须严格校验，防止路径穿越。 */
export function assertCellId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !CELL_ID.test(id)) throw new ShelfError('格子 id 无效')
}

function parsePalace(raw: string): Palace {
  const data = JSON.parse(raw) as Partial<Palace>
  if (data === null || typeof data !== 'object' || !Array.isArray(data.cells)) throw new Error('缺少 cells 数组')
  for (const c of data.cells) {
    if (typeof c?.id !== 'string' || !KINDS.has(c.kind) || !Number.isSafeInteger(c.col) || !Number.isSafeInteger(c.row) || typeof c.title !== 'string') {
      throw new Error(`格子格式有误：${JSON.stringify(c)?.slice(0, 80)}`)
    }
    if (c.parentId === undefined) c.parentId = null
  }
  return { ...data, schema: SCHEMA, cells: data.cells }
}

function parseItem(raw: string, id: string): Item {
  const data = JSON.parse(raw) as Partial<Item>
  if (data === null || typeof data !== 'object') throw new Error('不是 JSON 对象')
  const base = emptyItem(id)
  return {
    ...base, ...data, schema: SCHEMA, id,
    chapters: Array.isArray(data.chapters) ? data.chapters : [],
    cards: Array.isArray(data.cards) ? data.cards : [],
    inspirations: Array.isArray(data.inspirations) ? data.inspirations : [],
  }
}

/** 文件「版本」：修改时间 + 大小。只看修改时间的话，同一时刻的两次改动会被漏掉。 */
function stamp(file: string): string {
  const st = statSync(file)
  return `${st.mtimeMs}:${st.size}`
}

function writeAtomic(file: string, data: unknown): string {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return stamp(file)
}

interface Cached<T> {
  value: T
  stamp: string
  /** 磁盘上的文件解析失败：值是上一次的好版本，不能写入。 */
  broken: boolean
}

/** 一次修改里能用的东西。都是副本，fn 抛错就什么都不写。 */
export interface Tx {
  palace: Palace
  /** 读一个格子的内容（副本，直接改）。 */
  item(id: string): Item
  createItem(item: Item): void
  /** 提交时删除 items/<id>.json。 */
  deleteItem(id: string): void
  /** 提交成功后删除的卡片原图。 */
  deleteImage(name: string): void
}

export class PalaceStore {
  readonly dir: string
  readonly itemsDir: string
  readonly imagesDir: string
  private readonly palaceFile: string
  private palace: Cached<Palace> = { value: emptyPalace(), stamp: '', broken: false }
  private readonly items = new Map<string, Cached<Item>>()
  /** 每次写入 +1，前端轮询它判断是否需要刷新。 */
  rev = 1
  private queue: Promise<unknown> = Promise.resolve()

  constructor(dir: string) {
    this.dir = dir
    this.itemsDir = join(dir, 'items')
    this.imagesDir = join(dir, 'images')
    this.palaceFile = join(dir, 'palace.json')
    mkdirSync(this.itemsDir, { recursive: true })
    mkdirSync(this.imagesDir, { recursive: true })
    this.refreshPalace()
  }

  // ---------- 读 ----------

  private refreshPalace(): Cached<Palace> {
    if (!existsSync(this.palaceFile)) return this.palace
    const mtime = stamp(this.palaceFile)
    if (mtime === this.palace.stamp) return this.palace
    try {
      this.palace = { value: parsePalace(readFileSync(this.palaceFile, 'utf8')), stamp: mtime, broken: false }
    } catch (error) {
      console.warn('[dsh-shelf] palace.json 解析失败，继续使用内存中的数据', error)
      this.palace = { ...this.palace, stamp: mtime, broken: true }
    }
    this.rev += 1
    return this.palace
  }

  private refreshItem(id: string): Cached<Item> {
    assertCellId(id)
    const file = join(this.itemsDir, `${id}.json`)
    const cached = this.items.get(id)
    if (!existsSync(file)) {
      if (cached !== undefined) return cached
      return { value: emptyItem(id), stamp: '', broken: false }
    }
    const mtime = stamp(file)
    if (cached !== undefined && cached.stamp === mtime) return cached
    let next: Cached<Item>
    try {
      next = { value: parseItem(readFileSync(file, 'utf8'), id), stamp: mtime, broken: false }
    } catch (error) {
      console.warn(`[dsh-shelf] items/${id}.json 解析失败`, error)
      next = { value: cached?.value ?? emptyItem(id), stamp: mtime, broken: true }
    }
    if (cached !== undefined) this.rev += 1
    this.items.set(id, next)
    return next
  }

  getPalace(): Palace {
    return this.refreshPalace().value
  }

  getItem(id: string): Item {
    return this.refreshItem(id).value
  }

  /** 每个书 / 笔记格子的进度摘要。 */
  summaries(): Record<string, CellSummary> {
    const out: Record<string, CellSummary> = {}
    for (const cell of this.getPalace().cells) {
      if (cell.kind === 'group') continue
      out[cell.id] = summaryOf(this.getItem(cell.id))
    }
    return out
  }

  // ---------- 写 ----------

  /**
   * 串行执行一次修改。fn 抛错则不落盘。
   * 写入顺序：先写 item，再写 palace，最后删文件。中途失败时，最坏情况是多出没被引用的 item 文件，不会出现格子指向不存在的内容。
   */
  mutate<T>(fn: (tx: Tx) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const palaceState = this.refreshPalace()
      if (palaceState.broken) throw new ShelfError('palace.json 格式有误：请先修好或删掉这个文件，再继续操作')
      const palace = structuredClone(palaceState.value)
      const touched = new Map<string, { item: Item | null; before: string }>()
      const images: string[] = []
      const tx: Tx = {
        palace,
        item: (id) => {
          const hit = touched.get(id)
          if (hit !== undefined) {
            if (hit.item === null) throw new ShelfError('格子已删除')
            return hit.item
          }
          const state = this.refreshItem(id)
          if (state.broken) throw new ShelfError(`items/${id}.json 格式有误：请先修好或删掉这个文件`)
          const item = structuredClone(state.value)
          touched.set(id, { item, before: JSON.stringify(state.value) })
          return item
        },
        createItem: (item) => {
          assertCellId(item.id)
          touched.set(item.id, { item, before: '' })
        },
        deleteItem: (id) => {
          assertCellId(id)
          touched.set(id, { item: null, before: '' })
        },
        deleteImage: (name) => { images.push(name) },
      }
      const result = await fn(tx)

      for (const [id, { item, before }] of touched) {
        if (item === null || JSON.stringify(item) === before) continue
        const mtime = writeAtomic(join(this.itemsDir, `${id}.json`), item)
        this.items.set(id, { value: item, stamp: mtime, broken: false })
      }
      if (JSON.stringify(palace) !== JSON.stringify(palaceState.value)) {
        const mtime = writeAtomic(this.palaceFile, palace)
        this.palace = { value: palace, stamp: mtime, broken: false }
      }
      for (const [id, { item }] of touched) {
        if (item !== null) continue
        rmSync(join(this.itemsDir, `${id}.json`), { force: true })
        this.items.delete(id)
      }
      for (const name of images) {
        if (/^[\w.-]+$/.test(name)) rmSync(join(this.imagesDir, name), { force: true })
      }
      this.rev += 1
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }
}
