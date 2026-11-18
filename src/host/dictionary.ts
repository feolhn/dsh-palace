/**
 * 查词（#43）：用 macOS 自带的词典（Dictionary Services，和系统「查询」同一套），插件不带词库、不联网。
 * 用的是用户在「词典」App 里启用的词典（中文系统一般有牛津英汉汉英）；其他系统暂不支持。
 * 通过 osascript 的 JavaScript（JXA）调用 DCSCopyTextDefinition，单词作为参数传入，不拼进脚本。
 */
import { execFile } from 'node:child_process'
import { ShelfError } from '../core/store.ts'

const SCRIPT = `ObjC.import('CoreServices')
function run(argv) {
  const w = $(argv[0])
  const r = $.DCSCopyTextDefinition($(), w, $.CFRangeMake(0, w.length))
  return r ? ObjC.unwrap(ObjC.castRefToObject(r)) : ''
}`

/** 只查英文单词（可带连字符、撇号），防止把奇怪的东西交给系统。 */
export const WORD = /^[A-Za-zÀ-ɏ]+(?:['’-][A-Za-zÀ-ɏ]+)*$/

export interface Lookup {
  /** 当前系统能不能查。 */
  supported: boolean
  /** 系统词典的原文；没收录是 null。 */
  definition: string | null
  /** 变形词（fell → fall）：原形和它的释义。 */
  lemma?: { word: string; definition: string }
}

const cache = new Map<string, string | null>()

export async function lookupWord(word: string): Promise<Lookup> {
  if (process.platform !== 'darwin') return { supported: false, definition: null }
  const definition = await define(word.replace(/’/g, "'"))
  // 词典只给了「过去式 → fall」这样的指引：顺便查原形
  const to = definition !== null && definition.length < 160 ? /→\s*([A-Za-z]+(?:-[A-Za-z]+)*)/.exec(definition)?.[1] : undefined
  const base = to !== undefined && to.toLowerCase() !== word.toLowerCase() ? await define(to) : null
  return { supported: true, definition, ...(base !== null ? { lemma: { word: to!, definition: base } } : {}) }
}

async function define(key: string): Promise<string | null> {
  if (!WORD.test(key) || key.length > 80) return null
  if (cache.has(key)) return cache.get(key)!
  const text = await new Promise<string>((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, key], { timeout: 5000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) reject(new ShelfError('系统词典没有响应'))
      else resolve(stdout.trim())
    })
  })
  const definition = text === '' ? null : text
  if (cache.size > 2000) cache.clear()
  cache.set(key, definition)
  return definition
}
