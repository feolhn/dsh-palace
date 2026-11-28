/**
 * 演示台本（#107）。占位版本：文字等产品负责人和设计负责人在 #107 填好后替换。
 * 改台本只改这个目录：加一幕就加一个文件，在下面的 SCENES 里排好顺序。
 * 原话写用户自己的想法和 AI 的回应，不摘书或剧的原文。
 */
import type { NewCell, Scene } from '../script.ts'
import { opening } from './00-opening.ts'
import { addThings } from './01-add.ts'
import { connect } from './02-connect.ts'

/** 开场时宫殿里已有的几格 */
export const START: NewCell[] = [
  { id: 'kosmos', title: '宇宙', subtitle: '洪堡', kind: 'book', icon: 'earth', col: 0, row: 0, progress: 0.4 },
  { id: 'walk', title: '散步时想到的', icon: 'teardrop', col: 1, row: 0 },
  { id: 'mountain', title: '去年爬的那座山', icon: 'snow-mountain', col: 0, row: 1 },
]

/** 开场是不是轴测视图 */
export const START_ISO = true

export const SCENES: Scene[] = [opening, addThings, connect]
