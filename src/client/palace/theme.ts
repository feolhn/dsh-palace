/**
 * 皮肤（#102）：一套皮肤就是 vendor/themes/<id>/ 下的一份 theme.json 加几张图、一个字体，只有颜色和图片，没有 CSS 和脚本。
 * 界面结构、网格、交互不随皮肤变；代码只按 theme.json 填 CSS 变量、换图标和背景。
 * colors 里没写的颜色用 palace.css 里的默认值（就是水彩皮肤）。选了哪套皮肤记在本机。
 */
import { useSyncExternalStore, type CSSProperties } from 'react'
import { apiUrl } from '../api.ts'
import watercolor from '../../../vendor/themes/watercolor/theme.json'
import pixel from '../../../vendor/themes/pixel/theme.json'

/** 可以换颜色的槽位，对应 palace.css 里的 --mp-<名字>。 */
export const COLOR_SLOTS = [
  'ink', 'quiet', 'grid', 'dot', 'edge', 'fill', 'hover', 'panel', 'group', 'shadow',
  'ring', 'ringTrack', 'arc', 'arcOutline', 'arcCurrent',
] as const

export interface Theme {
  schema: 1
  name: string
  /** soft：圆角、毛玻璃、柔和阴影；hard：直角、实心投影、方形网格交点 */
  edges: 'soft' | 'hard'
  background: { color: string; image?: string }
  /** 界面字体；latinOnly 表示只含拉丁字母，中文用系统黑体 */
  font?: { file: string; latinOnly?: boolean }
  /** 图标图片：{key} 换成图标名。图片放在 77×77 图标框里、四周内缩 inset（负数就是往外扩） */
  icons: { file: string; inset: number; pixelated?: boolean }
  colors: Partial<Record<(typeof COLOR_SLOTS)[number], string>>
}

/** 官方皮肤，按显示顺序。 */
export const THEMES = { watercolor, pixel } as unknown as Record<string, Theme>
const DEFAULT = 'watercolor'
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

export function iconUrl(themeId: string, key: string): string {
  return fileUrl(themeId, THEMES[themeId].icons.file.replace('{key}', key))
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
