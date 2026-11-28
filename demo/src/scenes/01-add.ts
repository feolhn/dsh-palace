import type { Scene } from '../script.ts'

/** 放进来：两句带念头的意图，各长出一格（占位文字） */
export const addThings: Scene = {
  id: 'add',
  title: '放进来',
  actions: [
    { do: 'view', iso: false },
    { do: 'say', who: 'user', text: '放进《后会友期》，看哭了，老朋友原来会走散' },
    { do: 'addCell', cell: { id: 'show', title: '后会友期', subtitle: '芒果 TV', icon: 'moon', col: 1, row: 1 } },
    { do: 'say', who: 'user', text: '还有一本《创造自然》，想读很久了' },
    { do: 'addCell', cell: { id: 'nature', title: '创造自然', subtitle: 'The Invention of Nature', kind: 'book', icon: 'lotus-leaf', col: 2, row: 0, progress: 0.1 } },
  ],
}
