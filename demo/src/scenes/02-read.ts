import type { Scene } from '../script.ts'

/** 边读边聊：点书的图标进阅览室，在旁边和 AI 聊这本书，聊完回到宫殿（占位文字） */
export const readAndTalk: Scene = {
  id: 'read',
  title: '边读边聊',
  actions: [
    { do: 'read', id: 'kosmos' },
    { do: 'chat', open: true, heading: '与书对话' },
    { do: 'say', who: 'user', text: '高度一换，植物就换一批？' },
    { do: 'say', who: 'ai', text: '对。这一章在说：不相干的东西，常被同一条线串着' },
    { do: 'say', who: 'user', text: '有点像我散步时想到的' },
    { do: 'chat', open: false },
    { do: 'leave' },
  ],
}
