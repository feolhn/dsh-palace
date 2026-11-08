/**
 * 书架的全部业务操作。前端（HTTP 路由）和 AI 工具都调用这里，保证规则只有一份。
 */
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import {
  findSection, isDateString, progressOf,
  type Chapter, type Library, type Material, type Mistake, type MistakeStatus, type Section,
} from '../shared/model.ts'
import { readVideoCourse } from './bilibili.ts'
import { readPdfInfo } from './pdf.ts'
import { newId, nowIso, type ShelfStore } from './store.ts'

/** 用户可读的业务错误（路由返回 400，工具把 message 返回给 AI）。 */
export class ShelfError extends Error {}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new ShelfError(`${what}不存在`)
  return value
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ShelfError(`${what}不能为空`)
  return value.trim()
}

function optionalDate(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (!isDateString(value)) throw new ShelfError(`${what}格式应为 YYYY-MM-DD`)
  return value
}

export function material(lib: Library, id: string): Material {
  return need(lib.materials.find(m => m.id === id), '资料')
}

// ---------- 目录结构 ----------

export interface OutlineInput {
  title: string
  page?: number
  sections?: (string | { title: string; page?: number })[]
}

/**
 * 把 {章, 节[]} 输入转成带 id 的目录。没有节的章自动生成同名节。
 * 传入旧目录时，标题相同的节保留完成状态（重新生成目录不丢进度）。
 */
export function buildChapters(input: readonly OutlineInput[], previous: readonly Chapter[] = []): Chapter[] {
  const oldDone = new Map<string, Section>()
  for (const c of previous) for (const s of c.sections) if (s.done) oldDone.set(`${c.title}\u0000${s.title}`, s)
  return input
    .filter(c => typeof c?.title === 'string' && c.title.trim() !== '')
    .map((c): Chapter => {
      const title = c.title.trim()
      const raw = (c.sections ?? [])
        .map(s => (typeof s === 'string' ? { title: s } : s))
        .filter(s => typeof s?.title === 'string' && s.title.trim() !== '')
      const sections = (raw.length > 0 ? raw : [{ title, page: c.page }]).map((s): Section => {
        const st = s.title.trim()
        const old = oldDone.get(`${title}\u0000${st}`)
        return {
          id: newId('s'),
          title: st,
          ...(Number.isInteger(s.page) ? { page: s.page } : {}),
          done: old !== undefined,
          ...(old?.doneAt !== undefined ? { doneAt: old.doneAt } : {}),
        }
      })
      return { id: newId('c'), title, sections }
    })
}

// ---------- 目标 / 科目 ----------

export async function addGoal(store: ShelfStore, args: { name: unknown; examDate?: unknown }) {
  const name = text(args.name, '学习目标名称')
  const examDate = optionalDate(args.examDate, '考试日期')
  return store.mutate((lib) => {
    const goal = { id: newId('g'), name, ...(examDate ? { examDate } : {}), createdAt: nowIso() }
    lib.goals.push(goal)
    return goal
  })
}

export async function updateGoal(store: ShelfStore, args: { id: string; name?: unknown; examDate?: unknown }) {
  return store.mutate((lib) => {
    const goal = need(lib.goals.find(g => g.id === args.id), '学习目标')
    if (args.name !== undefined) goal.name = text(args.name, '学习目标名称')
    if (args.examDate !== undefined) {
      const date = optionalDate(args.examDate, '考试日期')
      if (date === undefined) delete goal.examDate
      else goal.examDate = date
    }
    return goal
  })
}

export async function deleteGoal(store: ShelfStore, args: { id: string }) {
  return store.mutate((lib) => {
    const subjects = new Set(lib.subjects.filter(s => s.goalId === args.id).map(s => s.id))
    const materials = new Set(lib.materials.filter(m => subjects.has(m.subjectId)).map(m => m.id))
    lib.goals = lib.goals.filter(g => g.id !== args.id)
    lib.subjects = lib.subjects.filter(s => !subjects.has(s.id))
    lib.materials = lib.materials.filter(m => !materials.has(m.id))
    lib.mistakes = lib.mistakes.filter(x => !materials.has(x.materialId))
  })
}

export async function addSubject(store: ShelfStore, args: { goalId: string; name: unknown }) {
  const name = text(args.name, '科目名称')
  return store.mutate((lib) => {
    need(lib.goals.find(g => g.id === args.goalId), '学习目标')
    const subject = { id: newId('sub'), goalId: args.goalId, name }
    lib.subjects.push(subject)
    return subject
  })
}

export async function updateSubject(store: ShelfStore, args: { id: string; name: unknown }) {
  const name = text(args.name, '科目名称')
  return store.mutate((lib) => {
    const subject = need(lib.subjects.find(s => s.id === args.id), '科目')
    subject.name = name
    return subject
  })
}

export async function deleteSubject(store: ShelfStore, args: { id: string }) {
  return store.mutate((lib) => {
    const materials = new Set(lib.materials.filter(m => m.subjectId === args.id).map(m => m.id))
    lib.subjects = lib.subjects.filter(s => s.id !== args.id)
    lib.materials = lib.materials.filter(m => !materials.has(m.id))
    lib.mistakes = lib.mistakes.filter(x => !materials.has(x.materialId))
  })
}

// ---------- 资料 ----------

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

export async function addBook(store: ShelfStore, args: { subjectId: string; file: unknown; title?: unknown; targetDate?: unknown }) {
  const file = expandHome(text(args.file, 'PDF 路径').replace(/^['"]|['"]$/g, ''))
  if (!isAbsolute(file)) throw new ShelfError('请提供 PDF 的完整路径（以 / 开头）')
  if (!existsSync(file) || !statSync(file).isFile()) throw new ShelfError(`找不到文件：${file}`)
  if (extname(file).toLowerCase() !== '.pdf') throw new ShelfError('目前只支持 PDF 文件')
  const targetDate = optionalDate(args.targetDate, '目标完成日期')
  let info
  try {
    info = await readPdfInfo(file)
  } catch (error) {
    throw new ShelfError(`PDF 打不开：${(error as Error).message}`)
  }
  const title = typeof args.title === 'string' && args.title.trim() !== ''
    ? args.title.trim()
    : basename(file, extname(file))
  const chapters = buildChapters(info.outline)
  return store.mutate((lib) => {
    need(lib.subjects.find(s => s.id === args.subjectId), '科目')
    const m: Material = {
      id: newId('m'),
      subjectId: args.subjectId,
      kind: 'book',
      title,
      file,
      pageCount: info.pageCount,
      ...(targetDate ? { targetDate } : {}),
      ...(chapters.length > 0 ? { outlineSource: 'bookmarks' as const } : {}),
      chapters,
      createdAt: nowIso(),
    }
    lib.materials.push(m)
    return m
  })
}

export async function addVideo(store: ShelfStore, args: { subjectId: string; url: unknown; title?: unknown; targetDate?: unknown }) {
  const url = text(args.url, '视频链接')
  const targetDate = optionalDate(args.targetDate, '目标完成日期')
  const course = await readVideoCourse(url).catch((error: Error) => {
    throw new ShelfError(error.message)
  })
  return store.mutate((lib) => {
    need(lib.subjects.find(s => s.id === args.subjectId), '科目')
    const m: Material = {
      id: newId('m'),
      subjectId: args.subjectId,
      kind: 'video',
      title: typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : course.title,
      url: course.url,
      ...(targetDate ? { targetDate } : {}),
      outlineSource: 'video',
      chapters: course.chapters.map(c => ({
        id: newId('c'),
        title: c.title,
        sections: c.episodes.map(e => ({ id: newId('s'), title: e.title, url: e.url, done: false })),
      })),
      createdAt: nowIso(),
    }
    lib.materials.push(m)
    return m
  })
}

export async function updateMaterial(store: ShelfStore, args: { id: string; title?: unknown; targetDate?: unknown; subjectId?: unknown }) {
  return store.mutate((lib) => {
    const m = material(lib, args.id)
    if (args.title !== undefined) m.title = text(args.title, '资料名称')
    if (args.targetDate !== undefined) {
      const date = optionalDate(args.targetDate, '目标完成日期')
      if (date === undefined) delete m.targetDate
      else m.targetDate = date
    }
    if (typeof args.subjectId === 'string') {
      need(lib.subjects.find(s => s.id === args.subjectId), '科目')
      m.subjectId = args.subjectId
    }
    return m
  })
}

export async function deleteMaterial(store: ShelfStore, args: { id: string }) {
  return store.mutate((lib) => {
    lib.materials = lib.materials.filter(m => m.id !== args.id)
    lib.mistakes = lib.mistakes.filter(x => x.materialId !== args.id)
  })
}

export async function setOutline(store: ShelfStore, args: { id: string; chapters: unknown; source?: Material['outlineSource'] }) {
  if (!Array.isArray(args.chapters) || args.chapters.length === 0) throw new ShelfError('目录不能为空')
  return store.mutate((lib) => {
    const m = material(lib, args.id)
    const chapters = buildChapters(args.chapters as OutlineInput[], m.chapters)
    if (chapters.length === 0) throw new ShelfError('目录不能为空')
    // 旧节被删掉后，挂在上面的错题改为"未归类"
    const kept = new Set(chapters.flatMap(c => c.sections.map(s => s.id)))
    m.chapters = chapters
    m.outlineSource = args.source ?? 'ai'
    for (const x of lib.mistakes) if (x.materialId === m.id && x.sectionId !== undefined && !kept.has(x.sectionId)) delete x.sectionId
    return m
  })
}

// ---------- 进度 ----------

export async function setSectionDone(store: ShelfStore, args: { materialId: string; sectionId: string; done: boolean }) {
  return store.mutate((lib) => {
    const found = need(findSection(material(lib, args.materialId), args.sectionId), '节')
    found.section.done = args.done
    if (args.done) found.section.doneAt = nowIso()
    else delete found.section.doneAt
  })
}

/** 「学到这里」：这一节及之前全部标记完成，之后的全部标记未完成。 */
export async function markUpTo(store: ShelfStore, args: { materialId: string; sectionId: string }) {
  return store.mutate((lib) => {
    const m = material(lib, args.materialId)
    need(findSection(m, args.sectionId), '节')
    let before = true
    const at = nowIso()
    for (const c of m.chapters) {
      for (const s of c.sections) {
        if (before && !s.done) { s.done = true; s.doneAt = at }
        if (!before && s.done) { s.done = false; delete s.doneAt }
        if (s.id === args.sectionId) before = false
      }
    }
  })
}

export async function resetProgress(store: ShelfStore, args: { materialId: string }) {
  return store.mutate((lib) => {
    for (const c of material(lib, args.materialId).chapters) {
      for (const s of c.sections) { s.done = false; delete s.doneAt }
    }
  })
}

// ---------- 错题 ----------

/** 在 Harness 附件目录里按 sha256 找图片（AI 只给出附件 id 时的兜底）。 */
function findAttachment(ref: string): string | undefined {
  const hex = ref.match(/sha256:([0-9a-f]{8,64})/i)?.[1]?.toLowerCase()
  if (hex === undefined) return undefined
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dir = join(home, 'attachments', 'v1', 'objects', hex.slice(0, 2))
  if (!existsSync(dir)) return undefined
  const name = readdirSync(dir).find(f => f.startsWith(hex))
  return name === undefined ? undefined : join(dir, name)
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** 把截图复制进书架的 images/ 目录，返回文件名。找不到就返回 undefined（不阻断记录）。 */
function saveImage(store: ShelfStore, id: string, ref: string | undefined): string | undefined {
  if (ref === undefined || ref.trim() === '') return undefined
  const cleaned = expandHome(ref.trim().replace(/^['"]|['"]$/g, ''))
  const source = isAbsolute(cleaned) && existsSync(cleaned) ? cleaned : findAttachment(cleaned)
  if (source === undefined) return undefined
  const ext = IMAGE_EXTS.has(extname(source).toLowerCase()) ? extname(source).toLowerCase() : '.png'
  const name = `${id}${ext}`
  copyFileSync(source, join(store.imagesDir, name))
  return name
}

export interface AddMistakeArgs {
  materialId: string
  sectionId?: string
  question: unknown
  answer?: unknown
  note?: unknown
  image?: string
}

export async function addMistake(store: ShelfStore, args: AddMistakeArgs) {
  const question = text(args.question, '题目')
  const id = newId('x')
  const image = saveImage(store, id, args.image)
  return store.mutate((lib) => {
    const m = material(lib, args.materialId)
    // 没指定节：默认挂到"当前在学"的那一节
    const sectionId = args.sectionId !== undefined
      ? need(findSection(m, args.sectionId), '节').section.id
      : (progressOf(m).current?.section.id ?? m.chapters.at(-1)?.sections.at(-1)?.id)
    const mistake: Mistake = {
      id,
      materialId: m.id,
      ...(sectionId !== undefined ? { sectionId } : {}),
      question,
      ...(typeof args.answer === 'string' && args.answer.trim() !== '' ? { answer: args.answer.trim() } : {}),
      ...(typeof args.note === 'string' && args.note.trim() !== '' ? { note: args.note.trim() } : {}),
      ...(image !== undefined ? { image } : {}),
      status: 'todo',
      createdAt: nowIso(),
    }
    lib.mistakes.push(mistake)
    return { mistake, material: m, imageSaved: image !== undefined }
  })
}

export async function updateMistake(store: ShelfStore, args: {
  id: string; sectionId?: string | null; status?: MistakeStatus; note?: unknown; question?: unknown; answer?: unknown
}) {
  return store.mutate((lib) => {
    const x = need(lib.mistakes.find(item => item.id === args.id), '错题')
    if (args.sectionId === null) delete x.sectionId
    else if (args.sectionId !== undefined) {
      x.sectionId = need(findSection(material(lib, x.materialId), args.sectionId), '节').section.id
    }
    if (args.status === 'todo' || args.status === 'mastered') x.status = args.status
    if (typeof args.note === 'string') { if (args.note.trim() === '') delete x.note; else x.note = args.note.trim() }
    if (typeof args.answer === 'string') { if (args.answer.trim() === '') delete x.answer; else x.answer = args.answer.trim() }
    if (args.question !== undefined) x.question = text(args.question, '题目')
    return x
  })
}

export async function deleteMistake(store: ShelfStore, args: { id: string }) {
  return store.mutate((lib) => {
    const x = lib.mistakes.find(item => item.id === args.id)
    lib.mistakes = lib.mistakes.filter(item => item.id !== args.id)
    if (x?.image !== undefined) rmSync(join(store.imagesDir, x.image), { force: true })
  })
}
