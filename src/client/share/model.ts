/**
 * 分享卡片的排版模型：草稿的读取 / 补默认值、选段、断行、排版。纯函数，不碰 DOM，方便测试。
 * 纸张固定 1080×1440（3:4），所有坐标都是纸张像素。排版规则参考设计负责人的分享编辑器原型。
 */

export const W = 1080
export const H = 1440
/** 正文区宽度（左右各留 120）。 */
const TEXT_WIDTH = 840
const SOURCE_SIZE = 27
const SOURCE_LEADING = 38

export type FontId = 'song' | 'kai' | 'fang' | 'hei'
/** 先用系统自带字体；字体包（汇文明朝体等）定下来后在这里加。 */
export const FONTS: Record<FontId, { label: string; family: string }> = {
  song: { label: '宋体', family: '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", serif' },
  kai: { label: '楷体', family: '"Kaiti SC", STKaiti, KaiTi, serif' },
  fang: { label: '仿宋', family: 'STFangsong, FangSong, serif' },
  hei: { label: '黑体', family: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif' },
}

export const PAPERS = ['#efe8d2', '#e8ece6', '#dfe7ec', '#f3e6e1', '#2f3b40']

export type TextKey = 'quote' | 'note'
/** UTF-16 偏移 [start, end)。 */
export type Range = [number, number]

export interface ShareDraft {
  v: 1
  color: string
  font: FontId
  size: number
  noteSize: number
  align: 'left' | 'center'
  showQuote: boolean
  showNote: boolean
  showSource: boolean
  /** 用户改写过的出处；没有就按书名和作者自动生成。 */
  source?: string
  /** 选中的段落；basis 是选段时原文的指纹，原文改了旧选段就作废。 */
  ranges: Record<TextKey, Range[]>
  basis: Record<TextKey, string>
}

export interface ShareTexts { quote: string; note: string }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 原文指纹：长度 + djb2，只用来判断原文有没有改过。 */
export function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return `${text.length}:${h.toString(36)}`
}

/** 整理选段：裁到文本长度内、去掉空段、排序、合并重叠。 */
export function normalizeRanges(list: unknown, length: number): Range[] {
  const valid = (Array.isArray(list) ? list : [])
    .filter((r): r is Range => Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]))
    .map(([a, b]): Range => [clamp(a, 0, length), clamp(b, 0, length)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of valid) {
    const last = out.at(-1)
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/** 选中的文字，多段之间用省略号隔开。 */
export function selectedText(text: string, ranges: Range[]): string {
  return normalizeRanges(ranges, text.length).map(([a, b]) => text.slice(a, b).trim()).filter(Boolean).join('\n…\n')
}

export function defaultSource(title: string, subtitle?: string): string {
  const author = (subtitle ?? '').split(/[／/]/).at(-1)?.trim() ?? ''
  return '— ' + [title ? `《${title}》` : '', author].filter(Boolean).join(' · ')
}

/** 从卡片里存的草稿读出可用的设置；缺的、坏的字段用默认值。 */
export function draftFor(saved: unknown, texts: ShareTexts): ShareDraft {
  const s = isObject(saved) ? saved : {}
  const size = clamp(Number(s.size) || 50, 28, 76)
  const ranges = {} as Record<TextKey, Range[]>
  const basis = {} as Record<TextKey, string>
  const savedRanges = isObject(s.ranges) ? s.ranges : {}
  const savedBasis = isObject(s.basis) ? s.basis : {}
  for (const k of ['quote', 'note'] as const) {
    const text = texts[k]
    basis[k] = fingerprint(text)
    // 原文没改过就沿用旧选段，否则整段都选上
    ranges[k] = savedBasis[k] === basis[k] && k in savedRanges ? normalizeRanges(savedRanges[k], text.length) : text ? [[0, text.length]] : []
  }
  return {
    v: 1,
    color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : PAPERS[0],
    font: typeof s.font === 'string' && Object.hasOwn(FONTS, s.font) ? s.font as FontId : 'song',
    size,
    noteSize: clamp(Number(s.noteSize) || Math.round(size * 0.72), 18, 76),
    align: s.align === 'left' ? 'left' : 'center',
    showQuote: s.showQuote !== false,
    showNote: s.showNote !== false,
    showSource: s.showSource !== false,
    ...(typeof s.source === 'string' ? { source: s.source } : {}),
    ranges,
    basis,
  }
}

const CLOSING = /^[，。！？；：、）》」』…,.!?;:)]/u

/** 按宽度断行：英文单词不拆开，行首不放句末标点（把上一行最后一个字带下来）。 */
export function wrap(text: string, maxWidth: number, measure: (t: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    const units = paragraph.match(/[\p{Script=Latin}\d]+(?:['’-][\p{Script=Latin}\d]+)*|[^\S\n]+|./gu) ?? []
    let line = ''
    for (const unit of units) {
      if (measure(line + unit) <= maxWidth) { line += unit; continue }
      if (line.trim()) {
        if (CLOSING.test(unit)) {
          const chars = [...line.trimEnd()]
          const last = chars.pop() ?? ''
          if (chars.length) lines.push(chars.join(''))
          line = last + unit
          continue
        }
        lines.push(line.trimEnd())
        line = ''
      }
      const clean = unit.trimStart()
      if (measure(clean) <= maxWidth) { line = clean; continue }
      for (const ch of clean) {
        if (line && measure(line + ch) > maxWidth) { lines.push(line); line = '' }
        line += ch
      }
    }
    if (line.trim()) lines.push(line.trimEnd())
  }
  return lines
}

export interface Block { kind: TextKey; size: number; leading: number; lines: string[]; top: number }
export interface Layout {
  blocks: Block[]
  source: string[]
  sourceTop: number
  /** 文字放不下一张纸（不裁切、不拆成多张，让用户删减或调小字号）。 */
  overflow: boolean
  empty: boolean
}

export function sourceOf(draft: ShareDraft, fallback: string): string {
  return draft.source ?? fallback
}

/** 排版：原文、想法依次排，整体在纸上垂直居中；出处固定在右下角。 */
export function layout(draft: ShareDraft, texts: ShareTexts, source: string, measure: (t: string, size: number) => number): Layout {
  const blocks: Block[] = []
  let height = 0
  const push = (kind: TextKey, size: number) => {
    const text = selectedText(texts[kind], draft.ranges[kind])
    if (!text) return
    const leading = Math.round(size * 1.65)
    const lines = wrap(text, TEXT_WIDTH, t => measure(t, size))
    const gap = blocks.length === 0 ? 0 : kind === 'note' ? 55 : 36
    blocks.push({ kind, size, leading, lines, top: height + gap })
    height += gap + lines.length * leading
  }
  if (draft.showQuote) push('quote', draft.size)
  if (draft.showNote) push('note', draft.noteSize)

  const sourceLines = draft.showSource && source.trim() ? wrap(source.trim(), TEXT_WIDTH, t => measure(t, SOURCE_SIZE)) : []
  const sourceHeight = sourceLines.length * SOURCE_LEADING
  const sourceTop = H - 120 - sourceHeight
  const top = 150
  const bottom = Math.min(1260, sourceTop - 65)
  const offset = Math.max(top, top + (bottom - top - height) / 2)
  for (const b of blocks) b.top += offset
  return { blocks, source: sourceLines, sourceTop, overflow: height > bottom - top || sourceHeight > 260, empty: blocks.length === 0 }
}

/** 深色纸配浅色字。 */
export function inkFor(color: string): string {
  const [r, g, b] = (color.match(/[0-9a-f]{2}/gi) ?? ['ff', 'ff', 'ff']).map(x => parseInt(x, 16))
  return r * 0.2126 + g * 0.7152 + b * 0.0722 < 110 ? '#f6efdf' : '#292821'
}

/** 保存时保留草稿里认不出的字段（以后的版本可能加了新设置）。 */
export function mergeDraft(saved: unknown, draft: ShareDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(isObject(saved) ? saved : {}), ...draft }
  if (draft.source === undefined) delete out.source
  return out
}
