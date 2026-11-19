/**
 * 水彩图标（#29）：设计负责人原型里的水彩物体，转成小 WebP 放在 vendor/icons/（scripts/make-icons.py 生成）。
 * 每张图都按原型校准画进同一个 77×77 的框（四周留 10 余量），显示时放在框的 (-10, -10)、97×97。
 * 格子没选图标时按 id 固定挑一个：分组默认彩虹，书默认月亮以外的物体随机分配，但同一个格子永远是同一个。
 * 以后：让 AI 用代码画水彩 SVG，一句话生成新图标。
 */
import type { Cell } from '../../shared/palace.ts'
import { apiUrl } from '../api.ts'

export const ICONS = [
  'moon', 'sun', 'rainbow', 'orange', 'open-book', 'shell', 'black-swan', 'snow-mountain',
  'earth', 'pufferfish', 'lotus-leaf', 'gold-coin', 'teardrop', 'mercury', 'venus', 'mars',
] as const

const POOL = ICONS.filter(k => k !== 'rainbow')

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function iconOf(cell: Pick<Cell, 'id' | 'kind' | 'icon'>): string {
  if (cell.icon !== undefined && (ICONS as readonly string[]).includes(cell.icon)) return cell.icon
  if (cell.kind === 'group') return 'rainbow'
  return POOL[hash(cell.id) % POOL.length]
}

export const iconUrl = (key: string) => `${apiUrl('asset')}?f=icons/${key}.webp`
