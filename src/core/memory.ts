/**
 * 记忆与电弧（#8，说明见 docs/CONTRACT.md §8）。不调模型：内容都由对话里的 AI 用工具写，这里只负责存、校验、拼上下文。
 *
 * - memory/me.md：用户的长期记忆；memory/cells/<id>.md：每格一页 wiki。都 ≤ PAGE_LIMIT 字，超了拒绝写入，让 AI 当场精简。
 * - links.jsonl：联想（原始数据，只追加）。一行一条：
 *     { type: 'link', id, from, to, why, evidence: [卡片/灵感 id], sessionId?, createdAt }
 *     { type: 'cut', from, to, createdAt }   用户剪断：之前的联想都不再显示，AI 也不能再自己连
 *   电弧不存，由联想算出（arcsOf）：股数 = 还有效的联想条数。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Cell, Item } from '../shared/palace.ts'
import { assertCellId, newId, nowIso, ShelfError, type PalaceStore } from './store.ts'

export const PAGE_LIMIT = 500
const SUMMARY_LIMIT = 40
const WHY_LIMIT = 40
const TOPIC_LIMIT = 5

export interface Page {
  /** 一句话：这一格对用户意味着什么（me 没有）。 */
  summary?: string
  topics?: string[]
  body: string
  writtenAt: string
}

export interface LinkRecord {
  type: 'link'
  id: string
  from: string
  to: string
  why: string
  evidence: string[]
  sessionId?: string
  createdAt: string
}

export interface CutRecord { type: 'cut'; from: string; to: string; createdAt: string }

export interface Arc {
  from: string
  to: string
  /** 股数：有效的联想条数。 */
  strands: number
  /** 最新一条联想的理由。 */
  why: string
  /** 最新一条联想的时间（前端按它画亮暗）。 */
  lastAt: string
  links: LinkRecord[]
}

/** 字数：按字符数（中文一个字算 1）。 */
const charCount = (s: string) => [...s].length

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** 一格里的记录（卡片和灵感）的 id → 创建时间。 */
function recordsOf(item: Item): Map<string, string> {
  const out = new Map<string, string>()
  for (const k of item.cards) out.set(k.id, k.createdAt)
  for (const i of item.inspirations) out.set(i.id, i.createdAt)
  return out
}

function parsePage(raw: string): Page {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (m === null) return { body: raw.trim(), writtenAt: '' }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  let topics: string[] | undefined
  try { topics = meta.topics ? JSON.parse(meta.topics) as string[] : undefined } catch { topics = undefined }
  return {
    ...(meta.summary ? { summary: meta.summary } : {}),
    ...(Array.isArray(topics) ? { topics: topics.filter(t => typeof t === 'string') } : {}),
    body: m[2].trim(),
    writtenAt: meta.writtenAt ?? '',
  }
}

function renderPage(p: Page): string {
  const meta = [
    ...(p.summary ? [`summary: ${p.summary}`] : []),
    ...(p.topics?.length ? [`topics: ${JSON.stringify(p.topics)}`] : []),
    `writtenAt: ${p.writtenAt}`,
  ]
  return `---\n${meta.join('\n')}\n---\n${p.body}\n`
}

export class Memory {
  readonly dir: string
  private readonly cellsDir: string
  private readonly linksFile: string
  private cache: { stamp: string; records: (LinkRecord | CutRecord)[] } = { stamp: '', records: [] }

  private readonly store: PalaceStore

  constructor(store: PalaceStore) {
    this.store = store
    this.dir = join(store.dir, 'memory')
    this.cellsDir = join(this.dir, 'cells')
    this.linksFile = join(store.dir, 'links.jsonl')
  }

  // ---------- 页面 ----------

  private pageFile(target: string): string {
    if (target === 'me') return join(this.dir, 'me.md')
    assertCellId(target)
    return join(this.cellsDir, `${target}.md`)
  }

  readPage(target: string): Page | undefined {
    const file = this.pageFile(target)
    if (!existsSync(file)) return undefined
    try { return parsePage(readFileSync(file, 'utf8')) } catch { return undefined }
  }

  /** 整页覆写。target 是 'me' 或书 / 笔记格子的 id。 */
  writePage(target: string, input: { summary?: unknown; topics?: unknown; body: unknown }): Page {
    if (target !== 'me') this.cellOf(target, false)
    if (typeof input.body !== 'string' || input.body.trim() === '') throw new ShelfError('正文不能为空')
    const body = input.body.trim()
    const n = charCount(body)
    if (n > PAGE_LIMIT) throw new ShelfError(`正文 ${n} 字，上限 ${PAGE_LIMIT} 字：请合并相近的内容、删掉过时的，精简后再写`)
    const summary = typeof input.summary === 'string' && input.summary.trim() !== '' ? input.summary.trim().replace(/\n/g, ' ') : undefined
    if (summary !== undefined && charCount(summary) > SUMMARY_LIMIT) throw new ShelfError(`一句话概括最多 ${SUMMARY_LIMIT} 字`)
    let topics: string[] | undefined
    if (input.topics !== undefined) {
      if (!Array.isArray(input.topics)) throw new ShelfError('主题词应为数组')
      topics = [...new Set(input.topics.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean))]
      if (topics.length > TOPIC_LIMIT) throw new ShelfError(`主题词最多 ${TOPIC_LIMIT} 个`)
    }
    const page: Page = {
      ...(target !== 'me' && summary ? { summary } : {}),
      ...(target !== 'me' && topics?.length ? { topics } : {}),
      body,
      writtenAt: nowIso(),
    }
    const file = this.pageFile(target)
    mkdirSync(this.cellsDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, renderPage(page), 'utf8')
    renameSync(tmp, file)
    return page
  }

  /** wiki 欠账：上次写这一页之后新增的卡片和灵感条数（没写过就是全部）。 */
  debt(id: string): number {
    const since = this.readPage(id)?.writtenAt ?? ''
    let n = 0
    for (const at of recordsOf(this.store.getItem(id)).values()) if (at > since) n += 1
    return n
  }

  // ---------- 联想 ----------

  private records(): (LinkRecord | CutRecord)[] {
    if (!existsSync(this.linksFile)) return []
    const st = statSync(this.linksFile)
    const stamp = `${st.mtimeMs}:${st.size}`
    if (stamp === this.cache.stamp) return this.cache.records
    const records: (LinkRecord | CutRecord)[] = []
    for (const line of readFileSync(this.linksFile, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const r = JSON.parse(line) as LinkRecord | CutRecord
        if ((r.type === 'link' || r.type === 'cut') && typeof r.from === 'string' && typeof r.to === 'string') records.push(r)
      } catch { /* 手改坏的行跳过，不影响其他行 */ }
    }
    this.cache = { stamp, records }
    return records
  }

  private append(record: LinkRecord | CutRecord): void {
    // 上一行没写完（中断或手改）时先补换行，免得新记录和坏行粘成一行一起被跳过
    const size = existsSync(this.linksFile) ? statSync(this.linksFile).size : 0
    const broken = size > 0 && readFileSync(this.linksFile, 'utf8').at(-1) !== '\n'
    appendFileSync(this.linksFile, (broken ? '\n' : '') + JSON.stringify(record) + '\n', 'utf8')
    this.store.rev += 1
  }

  private cellOf(id: unknown, allowGroup: boolean): Cell {
    assertCellId(id)
    const cell = this.store.getPalace().cells.find(c => c.id === id)
    if (cell === undefined || (!allowGroup && cell.kind === 'group')) throw new ShelfError('格子不存在')
    return cell
  }

  private lastCut(a: string, b: string): string {
    let at = ''
    for (const r of this.records()) if (r.type === 'cut' && pairKey(r.from, r.to) === pairKey(a, b) && r.createdAt > at) at = r.createdAt
    return at
  }

  /** 连一条联想。证据必须是两端格子里的卡片或灵感，且两端都至少有一条；用户剪断过的，要用户明确要求才能重连。 */
  addLink(args: { from: unknown; to: unknown; why: unknown; evidence: unknown; sessionId?: string; userAsked?: boolean }): LinkRecord {
    const from = this.cellOf(args.from, false)
    const to = this.cellOf(args.to, false)
    if (from.id === to.id) throw new ShelfError('不能连到自己')
    if (typeof args.why !== 'string' || args.why.trim() === '') throw new ShelfError('要写一句理由')
    const why = args.why.trim().replace(/\n/g, ' ')
    if (charCount(why) > WHY_LIMIT) throw new ShelfError(`理由最多 ${WHY_LIMIT} 字`)
    if (!Array.isArray(args.evidence)) throw new ShelfError('evidence 应为卡片 / 灵感 id 的数组')
    const evidence = [...new Set(args.evidence.filter((e): e is string => typeof e === 'string'))]
    const a = recordsOf(this.store.getItem(from.id))
    const b = recordsOf(this.store.getItem(to.id))
    const unknown = evidence.filter(e => !a.has(e) && !b.has(e))
    if (unknown.length > 0) throw new ShelfError(`这些证据不在两端的格子里：${unknown.join('、')}`)
    if (!evidence.some(e => a.has(e)) || !evidence.some(e => b.has(e))) throw new ShelfError('两端都要至少有一张卡片或一条灵感作为证据')
    if (this.lastCut(from.id, to.id) !== '' && args.userAsked !== true) throw new ShelfError('用户剪断过这两格之间的电弧：除非用户明确要求重新连，否则不要再连')
    // 至少要有一条这对格子还没用过的证据：旧证据换个组合不算，股数刷不高
    const used = new Set(this.validLinks().filter(l => pairKey(l.from, l.to) === pairKey(from.id, to.id)).flatMap(l => l.evidence))
    if (evidence.every(e => used.has(e))) throw new ShelfError('这些证据已经连过了；有新的卡片或灵感再连')
    const record: LinkRecord = { type: 'link', id: newId('l'), from: from.id, to: to.id, why, evidence, ...(args.sessionId ? { sessionId: args.sessionId } : {}), createdAt: nowIso() }
    this.append(record)
    return record
  }

  /** 用户剪断两格之间的电弧（追加记录，不删历史）。 */
  cut(args: { from: unknown; to: unknown }): void {
    const from = this.cellOf(args.from, true)
    const to = this.cellOf(args.to, true)
    this.append({ type: 'cut', from: from.id, to: to.id, createdAt: nowIso() })
  }

  /** 还有效的联想：两端格子都在、在最近一次剪断之后、两端各至少还剩一条证据。 */
  validLinks(): LinkRecord[] {
    const cells = new Map(this.store.getPalace().cells.filter(c => c.kind !== 'group').map(c => [c.id, c]))
    const recs = new Map<string, Map<string, string>>()
    const recordsFor = (id: string) => {
      let r = recs.get(id)
      if (r === undefined) { r = recordsOf(this.store.getItem(id)); recs.set(id, r) }
      return r
    }
    const cuts = new Map<string, string>()
    for (const r of this.records()) if (r.type === 'cut') { const k = pairKey(r.from, r.to); if (r.createdAt > (cuts.get(k) ?? '')) cuts.set(k, r.createdAt) }
    return this.records().filter((r): r is LinkRecord => {
      if (r.type !== 'link' || !cells.has(r.from) || !cells.has(r.to)) return false
      if (r.createdAt <= (cuts.get(pairKey(r.from, r.to)) ?? '')) return false
      const ev = Array.isArray(r.evidence) ? r.evidence : []
      return ev.some(e => recordsFor(r.from).has(e)) && ev.some(e => recordsFor(r.to).has(e))
    })
  }

  /** 电弧：按格子对聚合有效联想。 */
  arcs(): Arc[] {
    const byPair = new Map<string, LinkRecord[]>()
    for (const l of this.validLinks()) {
      const k = pairKey(l.from, l.to)
      byPair.set(k, [...(byPair.get(k) ?? []), l])
    }
    return [...byPair.values()].map((links) => {
      const latest = links.reduce((x, y) => (y.createdAt >= x.createdAt ? y : x)) // 同一毫秒按写入顺序取后写的
      return { from: latest.from, to: latest.to, strands: links.length, why: latest.why, lastAt: latest.createdAt, links }
    }).sort((x, y) => y.strands - x.strands || (y.lastAt > x.lastAt ? 1 : -1))
  }

  // ---------- 对话背景 ----------

  /** 一格最近一次有动静的时间（卡片、灵感、打勾、wiki、联想）。 */
  private lastTouched(cell: Cell, arcs: Arc[]): string {
    let at = cell.createdAt
    const bump = (t: string | undefined) => { if (t !== undefined && t > at) at = t }
    if (cell.kind !== 'group') {
      const item = this.store.getItem(cell.id)
      for (const t of recordsOf(item).values()) bump(t)
      for (const ch of item.chapters) for (const s of ch.sections) bump(s.doneAt)
      bump(this.readPage(cell.id)?.writtenAt)
    }
    for (const a of arcs) if (a.from === cell.id || a.to === cell.id) bump(a.lastAt)
    return at
  }

  /**
   * 新对话附带的背景：用户长期记忆 + 宫殿索引 + 当前格子的 wiki 和电弧。
   * 格子多时索引分级：最近活跃的和当前格的邻居写一整行，其余只列标题（总字数控制在 maxChars 内）。
   */
  context(opts: { itemId?: string; maxChars?: number }): string {
    const maxChars = opts.maxChars ?? 6000
    const palace = this.store.getPalace()
    const arcs = this.arcs()
    const current = opts.itemId !== undefined ? palace.cells.find(c => c.id === opts.itemId && c.kind !== 'group') : undefined
    const neighbors = new Set<string>()
    if (current) for (const a of arcs) if (a.from === current.id || a.to === current.id) neighbors.add(a.from === current.id ? a.to : a.from)
    const title = (id: string) => palace.cells.find(c => c.id === id)?.title ?? id
    const groupOf = (c: Cell) => (c.parentId ? palace.cells.find(g => g.id === c.parentId)?.title : undefined)

    const parts: string[] = []
    parts.push('## Memory Palace：记忆')
    parts.push('下面是你（AI）在宫殿里维护的记忆，帮助你认识用户、把用户的想法连起来。用法：'
      + '\n- 用户透露了值得长期记住的事（喜好、正在经历的事、深入聊过的话题），用 shelf_wiki_write(target="me") 整页更新「关于用户」；只记用户说过或做过的事实，尽量用用户原话，不推断、不扩写、不给用户贴性格标签。'
      + '\n- 在一格里聊出了新的认识，用 shelf_wiki_write 更新这一格的 wiki：只写卡片和灵感里没有的（这一格对用户意味着什么、卡在哪、反复出现的主题、没解决的疑问），句末用 [^卡片或灵感 id] 标出依据。'
      + '\n- 用户的想法把两格连在一起时（两本小说不会互相提及，但用户的念头会），用 shelf_link 连一条电弧，两端各带至少一张卡片或灵感作证据。'
      + `\n- 每页上限 ${PAGE_LIMIT} 字，超了会被拒绝：合并、删掉过时的，再整页重写。纯功能性的请求（加书、删书）不用管记忆。`
      + '\n- 别的格子的 wiki 用 shelf_wiki_read 读；下面的索引可能只是节选，全部格子用 shelf_overview 查。')

    const me = this.readPage('me')
    parts.push(`### 关于用户（me）\n${me ? me.body : '（还没有记录）'}`)

    const cells = palace.cells.filter(c => c.kind !== 'group')
    if (cells.length > 0) {
      const ranked = cells.map(c => ({ c, at: this.lastTouched(c, arcs) })).sort((x, y) => (y.at > x.at ? 1 : -1))
      const full: string[] = []
      const brief: string[] = []
      let used = parts.join('\n\n').length
      for (const [i, { c, at }] of ranked.entries()) {
        const page = this.readPage(c.id)
        const line = `- ${c.title} id=${c.id}${groupOf(c) ? ` 〔${groupOf(c)}〕` : ''}`
          + (page?.summary ? ` · ${page.summary}` : '')
          + (page?.topics?.length ? ` · ${page.topics.join('、')}` : '')
          + ` · ${at.slice(0, 7)}`
        const important = c.id === current?.id || neighbors.has(c.id) || i < 30
        if (important && used + line.length < maxChars * 0.7) { full.push(line); used += line.length + 1 }
        else brief.push(c.title)
      }
      let index = `### 宫殿索引（标题 · 一句话 · 主题词 · 最近活跃月份）\n${full.join('\n')}`
      if (brief.length > 0) index += `\n其余 ${brief.length} 格：${brief.join('、').slice(0, Math.max(200, maxChars - used - 800))}`
      parts.push(index)
    }

    if (current) {
      const page = this.readPage(current.id)
      const debt = this.debt(current.id)
      let block = `### 当前格子《${current.title}》的 wiki\n${page ? page.body : '（还没写）'}`
      if (debt > 0) block += `\n（这一页之后新增了 ${debt} 条卡片 / 灵感，方便时更新）`
      const mine = arcs.filter(a => a.from === current.id || a.to === current.id).slice(0, 8)
      if (mine.length > 0) block += `\n电弧：\n${mine.map(a => `- ↔ ${title(a.from === current.id ? a.to : a.from)}（${a.strands} 股）：${a.why}`).join('\n')}`
      parts.push(block)
    }
    const out = parts.join('\n\n')
    return out.length > maxChars ? out.slice(0, maxChars) : out
  }
}
