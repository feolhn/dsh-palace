/**
 * 书架数据模型（前后端共用）。
 * 一个 library.json 存全部数据；错题原图存在 images/ 目录。
 * 改字段 = 改契约，同步更新 docs/CONTRACT.md。
 */

/** 学习目标，如「2027 法考」。 */
export interface Goal {
  id: string
  name: string
  /** 考试日期 YYYY-MM-DD，可选（开放式学习不填）。 */
  examDate?: string
  createdAt: string
}

/** 科目，如「刑法」。 */
export interface Subject {
  id: string
  goalId: string
  name: string
}

/** 节：进度计数的最小单位。视频的一个分 P 也是一节。 */
export interface Section {
  id: string
  title: string
  /** 书：该节在 PDF 中的页码（1 起），来自书签，可能没有。 */
  page?: number
  /** 视频：该集的跳转链接。 */
  url?: string
  done: boolean
  doneAt?: string
}

/** 章。没有分节的章，会自动生成一个同名的节，保证进度总是按节计。 */
export interface Chapter {
  id: string
  title: string
  sections: Section[]
}

export type MaterialKind = 'book' | 'video'

/** 资料：一本书或一门视频课。 */
export interface Material {
  id: string
  subjectId: string
  kind: MaterialKind
  title: string
  /** 书：PDF 原文件的绝对路径（只引用，不复制）。 */
  file?: string
  pageCount?: number
  /** 视频：用户给的原始链接。 */
  url?: string
  /** 目标完成日期 YYYY-MM-DD。 */
  targetDate?: string
  /** 目录来源：书签 / AI / 视频列表 / 手动。 */
  outlineSource?: 'bookmarks' | 'ai' | 'video' | 'manual'
  chapters: Chapter[]
  createdAt: string
}

export type MistakeStatus = 'todo' | 'mastered'

/** 错题：挂在资料的某一节下面。 */
export interface Mistake {
  id: string
  materialId: string
  sectionId?: string
  /** AI 识别出的题目文字。 */
  question: string
  /** 正确答案 / 解析（可选）。 */
  answer?: string
  /** 用户或 AI 的备注，如错因。 */
  note?: string
  /** 原图文件名（相对 images/）。 */
  image?: string
  status: MistakeStatus
  createdAt: string
}

export interface Library {
  version: 1
  goals: Goal[]
  subjects: Subject[]
  materials: Material[]
  mistakes: Mistake[]
}

export function emptyLibrary(): Library {
  return { version: 1, goals: [], subjects: [], materials: [], mistakes: [] }
}

// ---------- 进度计算（纯函数，前后端一致） ----------

export interface Progress {
  done: number
  total: number
  /** 第一个未完成的节，即"当前在学"。 */
  current?: { chapter: Chapter; section: Section }
}

export function progressOf(material: Material): Progress {
  let done = 0
  let total = 0
  let current: Progress['current']
  for (const chapter of material.chapters) {
    for (const section of chapter.sections) {
      total += 1
      if (section.done) done += 1
      else if (current === undefined) current = { chapter, section }
    }
  }
  return { done, total, current }
}

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

export interface Pace {
  remaining: number
  /** 含今天在内剩余天数；已过期为 0 或负数。 */
  daysLeft: number
  /** 每天需要完成的节数（向上取一位小数）。 */
  perDay?: number
  overdue: boolean
}

/** 按目标日期倒推节奏：剩 N 节、每天约 M 节。没有目标日期返回 undefined。 */
export function paceOf(material: Material, now = today()): Pace | undefined {
  if (material.targetDate === undefined) return undefined
  const { done, total } = progressOf(material)
  const remaining = total - done
  const daysLeft = daysBetween(now, material.targetDate) + 1
  if (daysLeft <= 0) return { remaining, daysLeft, overdue: remaining > 0 }
  const perDay = remaining === 0 ? 0 : Math.ceil((remaining / daysLeft) * 10) / 10
  return { remaining, daysLeft, perDay, overdue: false }
}

/** 找到某一节及其所在章。 */
export function findSection(material: Material, sectionId: string | undefined): { chapter: Chapter; section: Section } | undefined {
  if (sectionId === undefined) return undefined
  for (const chapter of material.chapters) {
    const section = chapter.sections.find(s => s.id === sectionId)
    if (section !== undefined) return { chapter, section }
  }
  return undefined
}

export function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
