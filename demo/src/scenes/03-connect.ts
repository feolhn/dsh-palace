import type { Scene } from '../script.ts'

/** 连起来：AI 提出联系，用户认同后电弧才亮起，再拉远收尾（占位文字） */
export const connect: Scene = {
  id: 'connect',
  title: '连起来',
  actions: [
    { do: 'chat', open: true, heading: '与宫殿对话' },
    { do: 'say', who: 'ai', text: '你说老朋友会走散，和你写的「散步时想到的」像是同一件事' },
    { do: 'say', who: 'user', text: '对，就是这个' },
    { do: 'chat', open: false },
    { do: 'view', iso: true },
    { do: 'arc', from: 'show', to: 'walk', why: '人会走散，念头会留下', ms: 2600 },
    { do: 'caption', text: '懂你在想什么的 AI', ms: 3000 },
  ],
}
