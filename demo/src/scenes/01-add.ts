import type { Scene } from '../script.ts'

/** 放进来：点光球打开「与宫殿对话」，说两句带念头的意图，各长出一格（占位文字） */
export const addThings: Scene = {
  id: 'add',
  title: '放进来',
  actions: [
    { do: 'view', iso: false },
    { do: 'chat', open: true, heading: '与宫殿对话' },
    { do: 'say', who: 'user', text: '放进《后会友期》，看哭了，老朋友原来会走散' },
    { do: 'addCell', cell: { id: 'show', title: '后会友期', subtitle: '芒果 TV', icon: 'moon', col: 1, row: 1 } },
    { do: 'say', who: 'ai', text: '放好了，那句「会走散」也记下了' },
    { do: 'say', who: 'user', text: '还有一本《创造自然》，想读很久了' },
    { do: 'addCell', cell: { id: 'nature', title: '创造自然', subtitle: 'The Invention of Nature', kind: 'book', icon: 'lotus-leaf', col: 2, row: 0, progress: 0.1 } },
    { do: 'chat', open: false },
  ],
}
