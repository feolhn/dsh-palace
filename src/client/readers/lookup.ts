/**
 * 查词（#43）的纯逻辑：点中的是哪个英文单词、系统词典的文字怎么排版。点词逻辑移植自原型 word-lookup.js。
 */

/** text 里 offset 位置上的英文单词。 */
export function wordAt(text: string, offset: number): { text: string; start: number; end: number } | undefined {
  for (const m of text.matchAll(/[\p{Script=Latin}\p{M}]+(?:['’-][\p{Script=Latin}\p{M}]+)*/gu)) {
    const start = m.index, end = start + m[0].length
    if (offset >= start && offset <= end && m[0].length <= 80) return { text: m[0], start, end }
  }
  return undefined
}

/** 页面上 (x, y) 处的单词和它的位置（文档内坐标）。 */
export function wordFromPoint(doc: Document, x: number, y: number): { word: string; rect: DOMRect } | undefined {
  let node: Node | undefined, offset = 0
  const d = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  if (typeof d.caretPositionFromPoint === 'function') {
    const c = d.caretPositionFromPoint(x, y)
    if (c) { node = c.offsetNode; offset = c.offset }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const c = doc.caretRangeFromPoint(x, y)
    if (c) { node = c.startContainer; offset = c.startOffset }
  }
  if (node?.nodeType !== Node.TEXT_NODE) return undefined
  const word = wordAt(node.textContent ?? '', offset)
  if (word === undefined) return undefined
  const range = doc.createRange()
  range.setStart(node, word.start)
  range.setEnd(node, word.end)
  const rect = [...range.getClientRects()].find(r => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1)
  return rect ? { word: word.text, rect } : undefined
}

export interface Entry {
  head: string
  phonetic?: string
  /** 每个义项一段；例句（▸）单独成行。 */
  senses: { text: string; examples: string[] }[]
}

const TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/
const SYLLABLE = /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/
const CJK_END = /[㐀-鿿）」』…]$/

/** 去掉中文释义后面的拼音（英汉词典自带，读英文书用不到）：紧跟在汉字后面、带声调的一串小写音节。 */
function stripPinyin(s: string): string {
  if (!TONE.test(s)) return s
  const tokens = s.split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i])
    if (!CJK_END.test(tokens[i])) continue
    let j = i + 1
    while (j < tokens.length && SYLLABLE.test(tokens[j].replace(/[,，;；]$/, ''))) j++
    if (j > i + 1 && tokens.slice(i + 1, j).some(t => TONE.test(t))) {
      const tail = /[,，;；]$/.exec(tokens[j - 1])?.[0] ?? ''
      out[out.length - 1] += tail
      i = j - 1
    }
  }
  return out.join(' ').trim()
}

/**
 * 系统词典的纯文本是一整行：「词 | 音标 | 义项…」，义项用 ①② 或 A. B. 分开，例句以 ▸ 开头。
 * 拆成好读的几段；认不出格式就原样一段。
 */
export function formatEntry(raw: string): Entry {
  const parts = raw.split(' | ')
  const head = parts.length >= 2 ? parts[0].trim() : ''
  const phonetic = parts.length >= 3 ? parts[1].trim() : undefined
  const body = parts.length >= 3 ? parts.slice(2).join(' | ') : parts.length === 2 ? parts[1] : raw
  const chunks = body.split(/\s*(?=[①-⑳]|\b[A-H]\.\s)/u).map(c => c.trim()).filter(Boolean)
  const senses = chunks.map((c) => {
    const [text, ...examples] = c.split('▸').map(x => stripPinyin(x.trim()))
    return { text, examples: examples.filter(Boolean) }
  }).filter(s => s.text !== '' || s.examples.length > 0)
  return { head, ...(phonetic ? { phonetic } : {}), senses }
}
