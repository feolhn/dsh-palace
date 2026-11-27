/**
 * 皮肤（#102）：一套皮肤就是 vendor/themes/<id>/ 下的一份 theme.json 加几张图、一个字体，只有颜色和图片，没有 CSS 和脚本。
 * 界面结构、网格、交互不随皮肤变；代码只按 theme.json 填 CSS 变量、换图标和背景。
 * colors 里没写的颜色用 palace.css 里的默认值（就是水彩皮肤）。选了哪套皮肤记在本机。
 */
import { useSyncExternalStore, type CSSProperties } from 'react'
import { apiUrl } from '../api.ts'
import { ICONS } from './icons.ts'
import watercolor from '../../../vendor/themes/watercolor/theme.json'
import pixel from '../../../vendor/themes/pixel/theme.json'

/** 可以换颜色的槽位，对应 palace.css 里的 --mp-<名字>。 */
export const COLOR_SLOTS = [
  'ink', 'quiet', 'grid', 'dot', 'edge', 'fill', 'hover', 'panel', 'group', 'shadow',
  'ring', 'ringTrack', 'arc', 'arcOutline', 'arcCurrent', 'mark',
] as const

export interface Theme {
  schema: 1
  name: string
  /** soft：圆角、毛玻璃、柔和阴影；hard：直角、实心投影、方形网格交点 */
  edges: 'soft' | 'hard'
  background: { color: string; image?: string }
  /** 界面字体；latinOnly 表示只含拉丁字母，中文用系统黑体 */
  font?: { file: string; latinOnly?: boolean }
  /**
   * 图标图片：{key} 换成图标名。图片放在 77×77 图标框里、四周内缩 inset（负数就是往外扩）。
   * 16 个基础图标每套皮肤都有；more 是这套皮肤额外画的，别的皮肤没有时借这套的图来显示。
   */
  icons: { file: string; inset: number; pixelated?: boolean; more?: string[] }
  colors: Partial<Record<(typeof COLOR_SLOTS)[number], string>>
}

/** 官方皮肤，按显示顺序。 */
export const THEMES = { watercolor, pixel } as unknown as Record<string, Theme>
const DEFAULT = 'watercolor'
// icons.ts 也引用这里，所以 ICONS 只在函数里用，不在模块顶层取值
const isBase = (key: string) => (ICONS as readonly string[]).includes(key)
const STORE_KEY = 'dsh-palace:theme'

const listeners = new Set<() => void>()
function read(): string {
  try {
    const id = localStorage.getItem(STORE_KEY)
    return id !== null && id in THEMES ? id : DEFAULT
  } catch { return DEFAULT }
}
let current = read()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  // 侧栏和全屏各开一座宫殿时，在一边换了皮肤，另一边跟着换
  const onStorage = (e: StorageEvent) => { if (e.key === STORE_KEY) { current = read(); fn() } }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage) }
}

export function setTheme(id: string): void {
  if (!(id in THEMES)) return
  current = id
  try { localStorage.setItem(STORE_KEY, id) } catch { /* 存不了就只换这一次 */ }
  for (const fn of listeners) fn()
}

/** 当前皮肤的 id。 */
export function useThemeId(): string {
  return useSyncExternalStore(subscribe, () => current)
}

const fileUrl = (id: string, file: string) => apiUrl('asset', { f: `themes/${id}/${file}` })

/** 有这个图标的皮肤：当前皮肤有就用当前的，没有就借第一套画了它的。 */
function ownerOf(themeId: string, key: string): string {
  if (isBase(key) || THEMES[themeId].icons.more?.includes(key)) return themeId
  return Object.keys(THEMES).find(id => THEMES[id].icons.more?.includes(key)) ?? themeId
}

/** 图标图片的地址；借别的皮肤的图时带上那套皮肤的内缩和缩放方式（覆盖根节点上的 CSS 变量）。 */
export function iconImage(themeId: string, key: string): { src: string; style?: CSSProperties } {
  const owner = ownerOf(themeId, key)
  const icons = THEMES[owner].icons
  const src = fileUrl(owner, icons.file.replace('{key}', key))
  if (owner === themeId) return { src }
  return { src, style: { '--mp-icon-inset': `${icons.inset}px`, '--mp-icon-render': icons.pixelated ? 'pixelated' : 'auto' } as CSSProperties }
}

/** 当前皮肤能选的图标：基础的 16 个加上这套皮肤额外画的。 */
export function iconChoices(themeId: string): string[] {
  return [...ICONS, ...(THEMES[themeId].icons.more ?? [])]
}

/** 所有皮肤加起来认识的图标（格子里存的图标名要在这里面才算数）。 */
export function knownIcon(key: string): boolean {
  return isBase(key) || Object.values(THEMES).some(t => t.icons.more?.includes(key))
}

const loadedFonts = new Set<string>()
const fontFamily = (id: string) => `Palace Theme ${id}`

function loadFont(id: string, theme: Theme): void {
  if (theme.font === undefined || loadedFonts.has(id)) return
  loadedFonts.add(id)
  const face = new FontFace(fontFamily(id), `url("${fileUrl(id, theme.font.file)}")`, {
    display: 'swap',
    ...(theme.font.latinOnly ? { unicodeRange: 'U+0000-024F, U+2000-206F' } : {}),
  })
  document.fonts.add(face)
  face.load().catch(() => { /* 加载失败就用后备字体 */ })
}

const kebab = (s: string) => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'

/** 宫殿根节点上的 CSS 变量和类名。 */
export function themeRoot(id: string): { className: string; style: CSSProperties } {
  const theme = THEMES[id]
  loadFont(id, theme)
  const vars: Record<string, string> = {
    '--mp-bg': theme.background.color,
    '--mp-paper': theme.background.image ? `url("${fileUrl(id, theme.background.image)}")` : 'none',
    '--mp-icon-inset': `${theme.icons.inset}px`,
    '--mp-icon-render': theme.icons.pixelated ? 'pixelated' : 'auto',
  }
  for (const slot of COLOR_SLOTS) {
    const value = theme.colors[slot]
    if (value !== undefined) vars[`--mp-${kebab(slot)}`] = value
  }
  if (theme.font !== undefined) {
    // 像素这类字体一套就够：标题和正文都用它，中文落到系统黑体
    vars['--mp-serif'] = `"${fontFamily(id)}", ${SANS}`
    vars['--mp-sans'] = `"${fontFamily(id)}", ${SANS}`
  }
  return { className: theme.edges === 'hard' ? 'mp-hard' : '', style: vars as CSSProperties }
}

/** 划线、摘录高亮的颜色。EPUB 正文在 iframe 里读不到 CSS 变量，打开书时直接取这个值。 */
export function markColor(): string {
  return THEMES[current].colors.mark ?? '#f4dfa0'
}
