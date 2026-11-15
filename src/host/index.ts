/**
 * dsh-shelf Host 入口：注册 AI 工具 + 前端用的 HTTP 接口。
 * 数据目录默认 ~/Documents/dsh-shelf-data，可在 profile 的 cordis.patch.yml 里用 config.dataDir 修改。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PalaceStore } from '../core/store.ts'
import { createPalaceRoutes } from './palace-routes.ts'
import { createRoutes } from './routes.ts'
import { ShelfStore } from './store.ts'
import { createTools, type ActiveMaterials } from './tools.ts'

export const name = 'dsh-shelf'

export interface Config {
  /** 数据目录（library.json 与错题图片）。 */
  dataDir?: string
}

interface HostContext {
  inject(deps: string[], callback: (ctx: HostContext) => void): void
  effect(execute: () => () => unknown, label?: string): void
  tools: { register(tool: unknown): () => void }
  connection: { fetch: { register(route: unknown): () => Promise<void> } }
}

export function apply(ctx: HostContext, config: Config = {}): void {
  const dir = config.dataDir ?? join(homedir(), 'Documents', 'dsh-shelf-data')
  const store = new ShelfStore(dir)
  // v0.2：同一个数据目录，新格式（palace.json + items/），和 v0.1 的 library.json 互不影响
  const palace = new PalaceStore(dir)
  const active: ActiveMaterials = new Map()

  ctx.inject(['tools'], (scope) => {
    // tools.register 自带生命周期绑定：插件卸载时自动注销
    for (const tool of createTools(store, active)) scope.tools.register(tool)
  })

  ctx.inject(['connection'], (scope) => {
    for (const route of [...createRoutes(store, active), ...createPalaceRoutes(palace)]) {
      scope.effect(() => scope.connection.fetch.register(route), `dsh-shelf: ${route.path}`)
    }
  })
}
