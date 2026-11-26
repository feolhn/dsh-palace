/**
 * 格子图标（#29）：16 个物体，每套皮肤各画一份（vendor/themes/<皮肤>/icons/），图片地址见 theme.ts 的 iconUrl。
 * 图片在 77×77 图标框里的位置由皮肤的 icons.inset 决定（水彩往外扩 10，像素往里缩 6.5）。
 * 格子没选图标时按 id 固定挑一个：分组默认彩虹，书默认月亮以外的物体随机分配，但同一个格子永远是同一个。
 * 以后：让 AI 用代码画水彩 SVG，一句话生成新图标。
 */
import type { Cell } from '../../shared/palace.ts'

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
