/**
 * 给 AI 用的工具。原则：AI 做「非结构化 → 结构化」的事（读目录页、识别错题、总结对话成灵感），
 * 其余操作用户在界面里点就行。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as core from '../core/ops.ts'
import { Memory, PAGE_LIMIT } from '../core/memory.ts'
import { ShelfError, type PalaceStore } from '../core/store.ts'
import { findSection, paceOf, progressOf, type Card, type Cell, type Item } from '../shared/palace.ts'
import { addBook, saveImage } from './books.ts'
import { readPageTexts, SCANNED_THRESHOLD } from './pdf.ts'
import type { ActiveItems } from './routes.ts'

const stringOut = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const KIND_LABEL = { book: '书', note: '笔记', group: '分组' } as const
const CARD_LABEL = { excerpt: '摘录', thought: '想法', mistake: '错题' } as const

function cellLine(store: PalaceStore, c: Cell, active: string | undefined): string {
  let line = `${KIND_LABEL[c.kind]}「${c.title}」${c.subtitle ? `（${c.subtitle}）` : ''} id=${c.id}`
  if (c.kind !== 'group') {
    const item = store.getItem(c.id)
    const p = progressOf(item)
    const pace = paceOf(item)
    const todo = item.cards.filter(k => k.type === 'mistake' && k.status === 'todo').length
    if (item.source !== null) line += ` 原文 ${item.source.type}${item.source.type === 'pdf' ? ` ${item.source.pageCount} 页` : ''}`
    if (p.total > 0) line += ` 进度 ${p.done}/${p.total} 节`
    else if (item.source?.type === 'pdf') line += '（还没有目录）'
    if (item.targetDate) line += ` 目标日期 ${item.targetDate}`
    if (pace?.perDay !== undefined && pace.remaining > 0) line += ` 每天约 ${pace.perDay} 节`
    if (p.current) line += ` 当前：${p.current.chapter.title} › ${p.current.section.title}`
    if (item.cards.length > 0) line += ` 卡片 ${item.cards.length} 张${todo > 0 ? `（待重做错题 ${todo}）` : ''}`
    if (item.inspirations.length > 0) line += ` 灵感 ${item.inspirations.length} 条`
  }
  if (c.id === active) line += '  ← 用户当前打开的格子'
  return line
}

function describe(store: PalaceStore, active: string | undefined): string {
  const cells = store.getPalace().cells
  if (cells.length === 0) return '宫殿是空的。'
  const lines: string[] = []
  for (const c of cells.filter(x => x.parentId === null)) {
    lines.push(cellLine(store, c, active))
    for (const child of cells.filter(x => x.parentId === c.id)) lines.push(`  ${cellLine(store, child, active)}`)
  }
  return lines.join('\n')
}

function itemDetail(store: PalaceStore, id: string): string {
  const cell = store.getPalace().cells.find(c => c.id === id)
  if (cell === undefined || cell.kind === 'group') throw new ShelfError('格子不存在')
  const item = store.getItem(id)
  const outline = item.chapters.length === 0
    ? '（还没有目录）'
    : item.chapters.map((c, i) => `${i + 1}. ${c.title}\n${c.sections.map(s => `   - ${s.done ? '[x]' : '[ ]'} ${s.title} (section_id=${s.id})`).join('\n')}`).join('\n')
  const cards = item.cards.slice(-20).map(k => `- ${CARD_LABEL[k.type]} ${k.id}：${(k.quote ?? k.note ?? '').slice(0, 60)}`).join('\n')
  const insps = item.inspirations.slice(-10).map(i => `- ${i.id} ${i.createdAt.slice(0, 10)} ${i.title}`).join('\n')
  return `《${cell.title}》目录：\n${outline}`
    + (cards ? `\n\n最近的卡片：\n${cards}` : '')
    + (insps ? `\n\n灵感：\n${insps}` : '')
}

function where(item: Item, card: Card): string {
  const s = findSection(item, card.sectionId)
  return s ? ` ${s.chapter.title} › ${s.section.title}` : ''
}

async function guard(run: () => Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ShelfError) return `操作失败：${error.message}`
    throw error
  }
}

export function createTools(store: PalaceStore, active: ActiveItems, memory = new Memory(store)) {
  // 顺手维护的提示：每个对话、每格、每种提示只说一次，免得用户只想记张卡片时 AI 去大扫除
  const nudged = new Set<string>()
  const nudge = (exec: { agent?: { id: string } }, id: string, kind: 'wiki' | 'link'): string => {
    const key = `${exec.agent?.id ?? ''}:${id}:${kind}`
    if (nudged.has(key)) return ''
    if (kind === 'wiki') {
      const debt = memory.debt(id)
      if (debt < 3) return ''
      nudged.add(key)
      return `\n（提示：这一格的 wiki 之后新增了 ${debt} 条卡片 / 灵感，聊完方便时用 shelf_wiki_write 更新；不用打断用户。）`
    }
    nudged.add(key)
    return '\n（提示：如果这条和宫殿里别的格子有关——同一个念头、主题或疑问——可以用 shelf_link 连一条电弧。）'
  }
  const activeOf = (exec: { agent?: { id: string } }) => (exec.agent ? active.get(exec.agent.id) : undefined)
  const targetOf = (given: unknown, exec: { agent?: { id: string } }) => {
    const id = typeof given === 'string' && given !== '' ? given : activeOf(exec)
    if (id === undefined) throw new ShelfError('不知道记到哪个格子：用户没有打开格子。请先用 shelf_overview 查看后指定 item_id，或请用户在右侧 Memory Palace 打开对应的书。')
    return id
  }

  return [
    defineTool({
      name: 'shelf_overview',
      description: '查看用户的 Memory Palace（记忆宫殿）：所有分组、书、笔记的 id、进度、卡片数，以及用户当前打开的是哪个格子。'
        + '涉及宫殿的任何操作前先调用它拿到 id。传 item_id 可查看这个格子的完整目录（含 section_id）、最近的卡片和灵感。',
      parameters: {
        item_id: { type: 'string', description: '可选：查看这个格子的详情' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => (args.item_id === undefined ? describe(store, activeOf(exec)) : itemDetail(store, args.item_id)))
      },
    }),

    defineTool({
      name: 'shelf_add',
      description: '往宫殿里放东西。kind=group 新建分组（title）；kind=note 新建笔记格子（title，用于没有原文的东西：日记、心情、追剧）；'
        + 'kind=book 添加 PDF / EPUB（path 为绝对路径）或 B 站视频课（url），可选 title、subtitle（备注：格子上标题上方的一行小字，用户想填什么都行，常见是作者或另一种语言的书名）、target_date（YYYY-MM-DD）。'
        + 'parent_id 填分组 id 可以直接放进分组（分组里不能再放分组）。',
      parameters: {
        kind: { type: 'string', enum: ['group', 'note', 'book'], required: true },
        title: { type: 'string' },
        subtitle: { type: 'string' },
        parent_id: { type: 'string' },
        path: { type: 'string', description: 'book：PDF 或 EPUB 的绝对路径' },
        url: { type: 'string', description: 'book：B 站视频链接' },
        target_date: { type: 'string' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => {
          if (args.kind !== 'book') {
            const c = await core.addCell(store, { kind: args.kind, title: args.title, subtitle: args.subtitle, parentId: args.parent_id })
            return `已新建${KIND_LABEL[c.kind]}「${c.title}」 id=${c.id}`
          }
          const c = await addBook(store, { file: args.path, url: args.url, title: args.title, subtitle: args.subtitle, parentId: args.parent_id, targetDate: args.target_date }, exec.signal)
          const item = store.getItem(c.id)
          const total = progressOf(item).total
          if (item.source?.type === 'video') return `已添加视频课《${c.title}》 id=${c.id}，共 ${total} 集。`
          if (item.source?.type === 'epub') return `已添加《${c.title}》 id=${c.id}。用户第一次在笔记本里打开阅读时会自动读出目录。`
          return `已添加《${c.title}》 id=${c.id}，共 ${item.source?.type === 'pdf' ? item.source.pageCount : '?'} 页。`
            + (total > 0
              ? `已从 PDF 书签读出目录：${item.chapters.length} 章 ${total} 节。`
              : '这本 PDF 没有书签，需要生成目录：请用户在右侧笔记本的「进度」里勾选目录页，或告诉你目录在第几页，然后用 shelf_read 读取。')
        })
      },
    }),

    defineTool({
      name: 'shelf_remove',
      description: '从宫殿里删掉一个格子（书、笔记或空分组），连同它的进度、卡片和灵感，不删电脑上的原文件。'
        + '不可撤销：调用前必须先说清要删的是哪一个、会丢掉多少卡片和灵感，等用户明确同意后再调用。分组里还有东西时不能删。',
      parameters: {
        item_id: { type: 'string', required: true },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const cell = store.getPalace().cells.find(c => c.id === args.item_id)
          if (cell === undefined) throw new ShelfError('格子不存在')
          const item = cell.kind === 'group' ? undefined : store.getItem(cell.id)
          await core.deleteCell(store, { id: cell.id })
          return `已删除${KIND_LABEL[cell.kind]}「${cell.title}」`
            + (item ? `（卡片 ${item.cards.length} 张、灵感 ${item.inspirations.length} 条）` : '')
        })
      },
    }),

    defineTool({
      name: 'shelf_read',
      description: '读取某本 PDF 指定页的文字（页码为 PDF 的页序号，从 1 开始，不是书上印的页码）。用于读取目录页来生成章节结构。每次最多 30 页。',
      parameters: {
        item_id: { type: 'string', required: true },
        pages: { type: 'array', items: { type: 'integer' }, required: true, description: 'PDF 页序号列表' },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const source = store.getItem(args.item_id).source
          if (source?.type !== 'pdf') throw new ShelfError('这个格子不是 PDF')
          const pages = [...new Set(args.pages as number[])].slice(0, 30)
          const texts = await readPageTexts(source.path, pages)
          const scanned = texts.filter(t => t.text.length < SCANNED_THRESHOLD).map(t => t.page)
          let out = texts.map(t => `=== 第 ${t.page} 页 ===\n${t.text || '（无文字）'}`).join('\n\n')
          if (scanned.length > 0) {
            out += `\n\n注意：第 ${scanned.join('、')} 页没有文字层（可能是扫描件）。`
              + '如果对话里附有这些页的图片，请直接看图识别；否则请用户在右侧笔记本里重新勾选这些页（会把页面图片发到对话）。'
          }
          return out
        })
      },
    }),

    defineTool({
      name: 'shelf_set_outline',
      description: '写入（覆盖）书的目录结构，只要两级：章 › 节。没有分节的章，sections 留空即可（会自动算作一节）。'
        + '标题保持原书写法，去掉页码和省略号。重新生成目录时，标题不变的节会保留完成状态。'
        + '页码 page 可选，填 PDF 页序号（书上印的页码 + 偏移量）；不确定就不填。',
      parameters: {
        item_id: { type: 'string', required: true },
        chapters: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', required: true },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string', required: true },
                    page: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const input = (args.chapters as { title: string; sections?: { title: string; page?: number }[] }[]).map(c => ({
            title: c.title,
            sections: (c.sections ?? []).map(s => ({ title: s.title, ...(Number.isInteger(s.page) ? { loc: String(s.page) } : {}) })),
          }))
          const item = await core.setOutline(store, { id: args.item_id, chapters: input, source: 'ai' })
          return `已写入目录：${item.chapters.length} 章 ${progressOf(item).total} 节。用户可以在右侧笔记本里查看和打勾。`
        })
      },
    }),

    defineTool({
      name: 'shelf_set_target_dates',
      description: '设置书的目标完成日期（YYYY-MM-DD），用于规划进度。可一次设置多本。规划时参考各书的节数，并给复习留出时间。设置前先和用户确认方案。',
      parameters: {
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              item_id: { type: 'string', required: true },
              target_date: { type: 'string', required: true },
            },
          },
        },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const lines: string[] = []
          for (const entry of args.items as { item_id: string; target_date: string }[]) {
            const item = await core.updateItem(store, { id: entry.item_id, targetDate: entry.target_date })
            const title = store.getPalace().cells.find(c => c.id === entry.item_id)?.title ?? entry.item_id
            const pace = paceOf(item)
            lines.push(`《${title}》→ ${item.targetDate}` + (pace?.perDay !== undefined ? `，剩 ${pace.remaining} 节，每天约 ${pace.perDay} 节` : ''))
          }
          return `已设置：\n${lines.join('\n')}`
        })
      },
    }),

    defineTool({
      name: 'shelf_add_card',
      description: '记一张卡片。type=mistake 错题：用户发来错题截图并说「记错题」时调用，先看图把题目完整转成文字写进 quote（含选项），能判断的话把答案和解析写进 answer；'
        + 'type=excerpt 摘录：quote 是原文，note 是用户的想法；type=thought 想法：只有 note。'
        + 'image 填对话里图片的本地只读路径（图片说明中的 read-only path），没有路径就填附件 id（sha256:...）。'
        + 'item_id 不填时记到用户当前打开的格子；section_id 不填时，摘录和错题默认挂到当前在学的那一节。',
      parameters: {
        type: { type: 'string', enum: ['mistake', 'excerpt', 'thought'], required: true },
        quote: { type: 'string', description: '原文或题目' },
        note: { type: 'string', description: '想法、批注或错因（用户说了才填）' },
        answer: { type: 'string', description: '错题的答案与解析' },
        image: { type: 'string', description: '截图的本地路径或附件 id' },
        item_id: { type: 'string' },
        section_id: { type: 'string' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => {
          const id = targetOf(args.item_id, exec)
          const item = store.getItem(id)
          const sectionId = args.section_id ?? (args.type === 'thought' ? undefined : progressOf(item).current?.section.id)
          const image = saveImage(store, args.image)
          const card = await core.addCard(store, { id, type: args.type, quote: args.quote, note: args.note, answer: args.answer, image, sectionId })
          const title = store.getPalace().cells.find(c => c.id === id)?.title
          return `已记入《${title}》${where(store.getItem(id), card)}的${CARD_LABEL[card.type]}`
            + (args.image ? (image ? '，原图已保存。' : '。（没有找到原图）') : '。')
            + nudge(exec, id, 'wiki')
        })
      },
    }),

    defineTool({
      name: 'shelf_add_inspiration',
      description: '把这次对话存成一条「灵感」：用户说「存成灵感」「记下来」之类时调用。'
        + '用用户的口吻、简洁地总结这次对话里用户的想法和得出的结论（不是复述 AI 说了什么），body 用 Markdown，几段即可；title 一句话点题。'
        + 'item_id 不填时存到用户当前打开的格子。',
      parameters: {
        title: { type: 'string', required: true },
        body: { type: 'string', required: true },
        item_id: { type: 'string' },
        card_ids: { type: 'array', items: { type: 'string' }, description: '可选：这次对话涉及的卡片' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => {
          const id = targetOf(args.item_id, exec)
          const insp = await core.addInspiration(store, { id, title: args.title, body: args.body, cardIds: args.card_ids, sessionId: exec.agent?.id })
          const title = store.getPalace().cells.find(c => c.id === id)?.title
          return `已存到《${title}》的灵感：「${insp.title}」 id=${insp.id}` + nudge(exec, id, 'link') + nudge(exec, id, 'wiki')
        })
      },
    }),
    defineTool({
      name: 'shelf_wiki_read',
      description: '读一页记忆：target 填格子 id 读这一格的 wiki（一句话、主题词、正文），填 me 读「关于用户」。当前格子和 me 已经在对话背景里，读别的格子时才需要调用。',
      parameters: {
        target: { type: 'string', required: true, description: '格子 id 或 me' },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const page = memory.readPage(args.target)
          if (args.target !== 'me') {
            const cell = store.getPalace().cells.find(c => c.id === args.target)
            if (cell === undefined || cell.kind === 'group') throw new ShelfError('格子不存在')
            const debt = memory.debt(cell.id)
            if (page === undefined) return `《${cell.title}》还没有 wiki。` + (debt > 0 ? `已有 ${debt} 条卡片 / 灵感，可以用 shelf_overview 查看后写一页。` : '')
            return `《${cell.title}》wiki（${page.writtenAt.slice(0, 10)}）\n一句话：${page.summary ?? '（无）'}\n主题词：${page.topics?.join('、') ?? '（无）'}\n\n${page.body}`
              + (debt > 0 ? `\n\n（这一页之后新增了 ${debt} 条卡片 / 灵感）` : '')
          }
          return page === undefined ? '还没有关于用户的记录。' : `关于用户（${page.writtenAt.slice(0, 10)}）：\n${page.body}`
        })
      },
    }),

    defineTool({
      name: 'shelf_wiki_write',
      description: `整页重写一页记忆（会覆盖旧内容，先在旧内容基础上改）。正文最多 ${PAGE_LIMIT} 字，超了会被拒绝：合并相近的、删掉过时的再写。`
        + 'target=me：关于用户的长期记忆，分「长期」「最近」两段，只记用户说过或做过的事实（喜好、正在经历的事、深入聊过的话题），不贴性格标签。'
        + 'target=格子 id：这一格的 wiki，只写卡片和灵感里没有的东西（对用户意味着什么、卡在哪、反复出现的主题、没解决的疑问），句末用 [^卡片或灵感 id] 标出依据；'
        + 'summary 一句话（≤40 字），topics 3–5 个主题词（自由填写，跨格子相通的词更好，比如「等待」「孤独」）。',
      parameters: {
        target: { type: 'string', required: true, description: '格子 id 或 me' },
        body: { type: 'string', required: true, description: 'Markdown 正文' },
        summary: { type: 'string' },
        topics: { type: 'array', items: { type: 'string' } },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const page = memory.writePage(args.target, { body: args.body, summary: args.summary, topics: args.topics })
          if (args.target === 'me') return '已更新「关于用户」。'
          const title = store.getPalace().cells.find(c => c.id === args.target)?.title
          return `已更新《${title}》的 wiki` + (page.topics?.length ? `（主题词：${page.topics.join('、')}）` : '') + '。'
        })
      },
    }),

    defineTool({
      name: 'shelf_link',
      description: '在两格之间连一条电弧（联想）：用户的某个想法、主题或疑问把这两格连在一起时调用。不需要两本书互相提及，连的是用户的念头。'
        + 'why 一句话说清连在哪（≤40 字，例如「都在写等待：盖茨比等绿灯，你在等 offer」）；evidence 填两端各至少一张卡片或一条灵感的 id。'
        + '同样的证据不能重复连；有新证据就再连一条，电弧会变粗。用户剪断过的两格，除非用户明确要求，否则不要再连。',
      parameters: {
        from: { type: 'string', required: true, description: '格子 id' },
        to: { type: 'string', required: true, description: '格子 id' },
        why: { type: 'string', required: true },
        evidence: { type: 'array', items: { type: 'string' }, required: true, description: '卡片 / 灵感 id' },
        user_asked: { type: 'boolean', description: '用户明确要求连（剪断过的也能重连）' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => {
          const link = memory.addLink({ from: args.from, to: args.to, why: args.why, evidence: args.evidence, sessionId: exec.agent?.id, userAsked: args.user_asked === true })
          const cells = store.getPalace().cells
          const arc = memory.arcs().find(a => a.links.some(l => l.id === link.id))
          return `已连上《${cells.find(c => c.id === link.from)?.title}》↔《${cells.find(c => c.id === link.to)?.title}》：${link.why}（现在 ${arc?.strands ?? 1} 股）`
        })
      },
    }),

    defineTool({
      name: 'shelf_unlink',
      description: '剪断两格之间的电弧（用户说这两个没关系、连错了时调用）。之前的联想都不再显示，以后也不会自动再连。',
      parameters: {
        from: { type: 'string', required: true },
        to: { type: 'string', required: true },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          memory.cut({ from: args.from, to: args.to })
          return '已剪断。'
        })
      },
    }),
  ]
}
