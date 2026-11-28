/**
 * 演示数据快照（#107）：构建时用插件自己的 Core 读 demo/data/（格式和真实数据目录一样，见 docs/CONTRACT.md），
 * 把前端要的接口结果一次算好，写成一个 JSON。演示站的假接口只读这个文件。
 * 另外读 demo/data/chats.json：每格的聊天记录（真实的 Harness 对话不在数据目录里，只有演示站用）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Memory } from '../src/core/memory.ts'
import { PalaceStore } from '../src/core/store.ts'
import type { Item } from '../src/shared/palace.ts'

export interface ChatLine { who: 'user' | 'ai'; text: string }

export function snapshot(dir: string) {
  const store = new PalaceStore(dir)
  const memory = new Memory(store)
  const palace = store.getPalace()
  const items: Record<string, Item> = {}
  for (const c of palace.cells) if (c.kind !== 'group') items[c.id] = store.getItem(c.id)
  const chatsFile = join(dir, 'chats.json')
  const chats = existsSync(chatsFile) ? JSON.parse(readFileSync(chatsFile, 'utf8')) as Record<string, ChatLine[]> : {}
  // 聊天记录挂在 'palace'（与宫殿对话）或书 / 笔记格子上；写错 id 直接构建失败，免得悄悄不显示
  const ids = new Set(Object.keys(items))
  for (const [k, lines] of Object.entries(chats)) {
    if (k !== 'palace' && !ids.has(k)) throw new Error(`chats.json：找不到格子 ${k}`)
    for (const l of lines) if ((l.who !== 'user' && l.who !== 'ai') || typeof l.text !== 'string') throw new Error(`chats.json：${k} 里有一行格式不对`)
  }
  return { palace, summaries: store.summaries(), items, arcs: memory.arcs(), chats }
}

export type Snapshot = ReturnType<typeof snapshot>
