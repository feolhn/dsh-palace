/**
 * 宫殿数据：全局共享一份，有人在看时每 1.5 秒查一次 rev，变了就重新拉取（AI 改了数据，界面能跟上）。
 */
import { useSyncExternalStore } from 'react'
import type { CellSummary, Item, Palace } from '../../shared/palace.ts'
import { apiUrl } from '../api.ts'

interface State {
  palace?: Palace
  summaries: Record<string, CellSummary>
  dataDir?: string
  error?: string
  rev: number
}

let state: State = { summaries: {}, rev: 0 }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let loading: Promise<void> | undefined

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({ ok: false, error: `请求失败（HTTP ${response.status}）` })) as { ok: boolean; error?: string } & T
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`)
  return body
}

function emit(next: State): void {
  state = next
  for (const l of listeners) l()
}

export function refreshPalace(): Promise<void> {
  loading ??= fetch(apiUrl('palace'), { cache: 'no-store' })
    .then(r => readJson<{ rev: number; palace: Palace; summaries: Record<string, CellSummary>; dataDir: string }>(r))
    .then(r => emit({ palace: r.palace, summaries: r.summaries, dataDir: r.dataDir, rev: r.rev }))
    .catch((error: Error) => emit({ ...state, error: error.message }))
    .finally(() => { loading = undefined })
  return loading
}

async function poll(): Promise<void> {
  if (document.visibilityState !== 'visible') return
  try {
    const { rev } = await readJson<{ rev: number }>(await fetch(apiUrl('palace/rev'), { cache: 'no-store' }))
    if (rev !== state.rev) await refreshPalace()
  } catch {
    // Host 重启中：下一轮再试
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshPalace()
    timer = setInterval(() => void poll(), 1500)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function usePalace(): State {
  return useSyncExternalStore(subscribe, () => state)
}

/** 执行一个写操作（白名单见 host/palace-routes.ts），成功后刷新。 */
export async function palaceOp<T = unknown>(op: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(apiUrl('palace/op'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, args }),
  })
  const { result } = await readJson<{ result: T }>(response)
  await refreshPalace()
  return result
}

export async function getItem(id: string): Promise<Item> {
  return (await readJson<{ item: Item }>(await fetch(apiUrl('item', { id }), { cache: 'no-store' }))).item
}
