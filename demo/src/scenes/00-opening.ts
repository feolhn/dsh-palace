import type { Scene } from '../script.ts'

/** 开场：已有几格的宫殿，叠一行定位文案（文案待定） */
export const opening: Scene = {
  id: 'opening',
  title: '开场',
  actions: [
    { do: 'caption', text: '懂你在想什么的 AI', ms: 3000 },
  ],
}
