/**
 * 需要先读原文的操作：添加书（读 PDF 书签 / B 站分 P）、保存卡片原图。
 * 都要等待（读文件、联网），所以在 core 的 mutate 之外先做完。
 */
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import * as core from '../core/ops.ts'
import { newId, ShelfError, type PalaceStore } from '../core/store.ts'
import type { SourceRef } from '../shared/palace.ts'
import { readVideoCourse } from './bilibili.ts'
import { readPdfInfo } from './pdf.ts'

export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/**
 * 添加一本书：先读原文（PDF 页数和书签、B 站分 P），再一次性建格子。
 * 读原文要等待，所以放在 mutate 之外。取消（signal）后不写入任何数据（CONTRACT §4.1）。
 */
export async function addBook(store: PalaceStore, args: { file?: unknown; url?: unknown; title?: unknown; subtitle?: unknown; parentId?: unknown; targetDate?: unknown }, signal?: AbortSignal) {
  const cancelled = () => { if (signal?.aborted) throw new ShelfError('已取消') }
  let source: SourceRef
  let title: string
  let outline: core.OutlineInput[] = []
  let outlineSource: 'bookmarks' | 'video' | undefined
  if (typeof args.url === 'string' && args.url.trim() !== '') {
    const course = await readVideoCourse(args.url.trim(), signal).catch((error: Error) => { cancelled(); throw new ShelfError(error.message) })
    source = { type: 'video', url: course.url }
    title = course.title
    outline = course.chapters.map(c => ({ title: c.title, sections: c.episodes.map(e => ({ title: e.title, loc: e.url })) }))
    outlineSource = 'video'
  } else if (typeof args.file === 'string' && args.file.trim() !== '') {
    const file = expandHome(args.file.trim().replace(/^['"]|['"]$/g, ''))
    if (!isAbsolute(file)) throw new ShelfError('请提供 PDF 的完整路径（以 / 开头）')
    if (!existsSync(file) || !statSync(file).isFile()) throw new ShelfError(`找不到文件：${file}`)
    if (extname(file).toLowerCase() !== '.pdf') throw new ShelfError('目前只支持 PDF 文件（EPUB 在做了）')
    const info = await readPdfInfo(file).catch((error: Error) => { throw new ShelfError(`PDF 打不开：${error.message}`) })
    source = { type: 'pdf', path: file, pageCount: info.pageCount }
    title = basename(file, extname(file))
    outline = info.outline.map(c => ({
      title: c.title,
      ...(c.page !== undefined ? { loc: String(c.page) } : {}),
      sections: c.sections.map(s => ({ title: s.title, ...(s.page !== undefined ? { loc: String(s.page) } : {}) })),
    }))
    outlineSource = 'bookmarks'
  } else {
    throw new ShelfError('请选择 PDF 文件，或粘贴视频链接')
  }
  if (typeof args.title === 'string' && args.title.trim() !== '') title = args.title.trim()
  cancelled()
  return core.addCell(store, { kind: 'book', title, subtitle: args.subtitle, source, parentId: args.parentId, targetDate: args.targetDate, outline, outlineSource })
}

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

/** 把截图复制进 images/，返回新文件名（每次都是新名字，保证一张图只属于一张卡片）。找不到就返回 undefined，不阻断记录。 */
export function saveImage(store: PalaceStore, ref: unknown): string | undefined {
  if (typeof ref !== 'string' || ref.trim() === '') return undefined
  const cleaned = expandHome(ref.trim().replace(/^['"]|['"]$/g, ''))
  const source = isAbsolute(cleaned) && existsSync(cleaned) ? cleaned : findAttachment(cleaned)
  if (source === undefined) return undefined
  const ext = IMAGE_EXTS.has(extname(source).toLowerCase()) ? extname(source).toLowerCase() : '.png'
  const name = `${newId('img')}${ext}`
  copyFileSync(source, join(store.imagesDir, name))
  return name
}
