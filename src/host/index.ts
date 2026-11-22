/**
 * dsh-palace Host 入口：注册 AI 工具 + 前端用的 HTTP 接口。
 * 数据目录默认 ~/Documents/dsh-palace-data，可在 profile 的 cordis.patch.yml 里用 config.dataDir 修改。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Memory } from '../core/memory.ts'
import { PalaceStore } from '../core/store.ts'
import { createRoutes, type ActiveItems } from './routes.ts'
import { createTools } from './tools.ts'

export const name = 'dsh-palace'

export interface Config {
  /** 数据目录（palace.json、items/、images/）。 */
  dataDir?: string
}

interface HostContext {
  inject(deps: string[], callback: (ctx: HostContext) => void): void
  effect(execute: () => () => unknown, label?: string): void
  tools: { register(tool: unknown): () => void }
  connection: { fetch: { register(route: unknown): () => Promise<void> } }
  systemPrompt: {
    context(input: { name: string; order: number; interpolate?: boolean; text: (c: { agent?: PromptAgent }) => string }): unknown
  }
}

/** system prompt 组装时拿到的 agent：id 就是会话 id。 */
interface PromptAgent { id: string; session?: { header?: { cwd?: string } } }

/**
 * 默认数据目录 ~/Documents/dsh-palace-data。
 * 插件以前叫 dsh-shelf（beta），数据在 ~/Documents/dsh-shelf-data：新目录里还没有宫殿时继续用老目录。
 * 不搬家：老对话的工作目录就在老目录下，搬走了续聊会找不到（#74）。
 */
function defaultDataDir(): string {
  const dir = join(homedir(), 'Documents', 'dsh-palace-data')
  const old = join(homedir(), 'Documents', 'dsh-shelf-data')
  return !existsSync(join(dir, 'palace.json')) && existsSync(join(old, 'palace.json')) ? old : dir
}

export function apply(ctx: HostContext, config: Config = {}): void {
  const dir = config.dataDir ?? defaultDataDir()
  const store = new PalaceStore(dir)
  const active: ActiveItems = new Map()
  const memory = new Memory(store)

  ctx.inject(['tools'], (scope) => {
    // tools.register 自带生命周期绑定：插件卸载时自动注销
    for (const tool of createTools(store, active, memory)) scope.tools.register(tool)
  })

  // 记忆（#8）：只给宫殿的对话（建在数据目录下，或打开了某个格子的）附上，不打扰用户别的对话
  ctx.inject(['systemPrompt'], (scope) => {
    const home = resolve(dir)
    scope.systemPrompt.context({
      name: 'dsh-palace:memory',
      order: 5000,
      interpolate: false,
      text: ({ agent }) => {
        if (agent === undefined) return ''
        const itemId = active.get(agent.id)
        const cwd = agent.session?.header?.cwd
        if (itemId === undefined && (cwd === undefined || resolve(cwd) !== home)) return ''
        try {
          return memory.context({ itemId })
        } catch (error) {
          console.warn('[dsh-palace] 记忆背景生成失败，已跳过', error)
          return ''
        }
      },
    })
  })

  ctx.inject(['connection'], (scope) => {
    for (const route of createRoutes(store, active, memory)) {
      scope.effect(() => scope.connection.fetch.register(route), `dsh-palace: ${route.path}`)
    }
  })
}
