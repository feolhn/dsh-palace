/**
 * 演示站的内存 store：让 Core 的 ops（挪格子、拖成组、改名、换图标）直接在浏览器里跑，规则和插件只有一份。
 * 只实现 ops 用到的 mutate(tx)；改动只在当前页面里，刷新就回到原样。
 * Core 引用的 node:fs 等在打包时换成空壳（demo/build.mjs），这几个 op 用不到它们。
 */
import type { PalaceStore, Tx } from '../../src/core/store.ts'
import type { Item, Palace } from '../../src/shared/palace.ts'

export function memStore(data: { palace: Palace; items: Record<string, Item> }): PalaceStore {
  const store = {
    mutate<T>(fn: (tx: Tx) => T): Promise<T> {
      try {
        // 先在副本上改，fn 抛错就什么都不变（和真的 store 一样）
        const palace = structuredClone(data.palace)
        const items = new Map<string, Item | null>()
        const tx: Tx = {
          palace,
          item: (id) => {
            if (!items.has(id)) items.set(id, structuredClone(data.items[id]))
            const it = items.get(id)
            if (it === null || it === undefined) throw new Error('格子已删除')
            return it
          },
          createItem: (item) => { items.set(item.id, item) },
          deleteItem: (id) => { items.set(id, null) },
          deleteImage: () => undefined,
        }
        const result = fn(tx)
        data.palace = palace
        for (const [id, it] of items) { if (it === null) delete data.items[id]; else data.items[id] = it }
        return Promise.resolve(result)
      } catch (error) {
        return Promise.reject(error)
      }
    },
  }
  return store as unknown as PalaceStore
}
