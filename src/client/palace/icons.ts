/**
 * 格子图标（#29）：16 个基础物体，每套皮肤各画一份（vendor/themes/<皮肤>/icons/）；皮肤还可以在 theme.json 的 icons.more 里多画一些，
 * 别的皮肤没有时借它的图显示。图片地址见 theme.ts 的 iconImage。
 * 图片在 77×77 图标框里的位置由皮肤的 icons.inset 决定（水彩往外扩 10，像素往里缩 6.5）。
 * 格子没选图标时按 id 固定挑一个：分组默认彩虹，书默认月亮以外的物体随机分配，但同一个格子永远是同一个。
 * 以后：让 AI 用代码画水彩 SVG，一句话生成新图标。
 */
import type { Cell } from '../../shared/palace.ts'
import { knownIcon } from './theme.ts'

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
  if (cell.icon !== undefined && knownIcon(cell.icon)) return cell.icon
  if (cell.kind === 'group') return 'rainbow'
  return POOL[hash(cell.id) % POOL.length]
}

/** 选择器里悬停显示的中文名（基础图标就用英文键名）。 */
export const ICON_NAMES: Record<string, string> = {
  'tennis-racket': '网球拍', 'tennis-ball': '网球', 'rock-climber': '攀岩', carabiner: '攀岩扣', 'climbing-shoe': '攀岩鞋', 'chalk-bag': '镁粉袋',
  badminton: '羽毛球', 'running-shoe': '跑步', cycling: '骑行', 'swim-goggles': '游泳', surfing: '冲浪', skiing: '滑雪',
  'hiking-pack': '徒步', camping: '露营', kayaking: '皮划艇', 'yoga-mat': '瑜伽', camera: '摄影', painting: '绘画',
  headphones: '音乐', pottery: '陶艺', cooking: '烹饪', coffee: '咖啡', gardening: '园艺', stargazing: '观星',
  'hold-jug': '大抓点', 'hold-sloper': '圆斜面', 'hold-crimp': '薄边', 'hold-pinch': '夹点', 'hold-pocket-one': '单指洞', 'hold-pocket-two': '双孔点',
  'hold-horn': '牛角点', 'hold-rail': '长条边', 'hold-foot-chip': '小脚点', 'hold-volume-triangle': '三角体', 'hold-volume-diamond': '菱形体', 'hold-cluster': '岩点组合',
  door: '门', fire: '火', snowboard: '单板', 'alpine-skis': '双板滑雪', motorcycle: '摩托车',
}
