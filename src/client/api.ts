/**
 * 前端调用 Host 接口。路径相对应用根（桌面版是 dsh-app://，网页版是 http://localhost）。
 */
import type { Library } from '../shared/model.ts'

export function apiUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(`api/dsh-shelf/${path}`, document.baseURI)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return url.href
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({ ok: false, error: `请求失败（HTTP ${response.status}）` })) as { ok: boolean; error?: string } & T
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`)
  return body
}

export async function getLibrary(): Promise<{ rev: number; library: Library; dataDir: string }> {
  return readJson(await fetch(apiUrl('library'), { cache: 'no-store' }))
}

export async function getRev(): Promise<number> {
  return (await readJson<{ rev: number }>(await fetch(apiUrl('rev'), { cache: 'no-store' }))).rev
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return readJson<T>(await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

/** 执行一个写操作（白名单见 Host routes.ts 的 OPS）。成功后自动刷新书架。 */
export async function op<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { result } = await post<{ result: T }>('op', { op: name, args })
  void refreshLibrary()
  return result
}

export async function pickPdf(): Promise<string | null | undefined> {
  return (await post<{ path: string | null | undefined }>('pick-file', {})).path
}

export async function openTarget(materialId: string, sectionId?: string): Promise<void> {
  await post('open', { materialId, sectionId })
}

export async function openDataDir(): Promise<void> {
  await post('open', { target: 'dataDir' })
}

export async function setActive(sessionId: string, materialId: string | null): Promise<void> {
  await post('active', { sessionId, materialId })
}

export async function pageTexts(materialId: string, pages: number[]): Promise<{ pages: { page: number; text: string }[]; scanned: number[] }> {
  return readJson(await fetch(apiUrl('page-text', { id: materialId, pages: pages.join(',') })))
}

// ---------- 书架数据：全局共享 + 轮询 rev ----------

interface State { library?: Library; dataDir?: string; error?: string; rev: number }

let state: State = { rev: 0 }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let loading: Promise<void> | undefined

function emit(next: State): void {
  state = next
  for (const l of listeners) l()
}

export function refreshLibrary(): Promise<void> {
  loading ??= getLibrary()
    .then(r => emit({ library: r.library, dataDir: r.dataDir, rev: r.rev }))
    .catch((error: Error) => emit({ ...state, error: error.message }))
    .finally(() => { loading = undefined })
  return loading
}

async function poll(): Promise<void> {
  if (document.visibilityState !== 'visible') return
  try {
    const rev = await getRev()
    if (rev !== state.rev) await refreshLibrary()
  } catch {
    // Host 重启中：下一轮再试
  }
}

/** useSyncExternalStore 的订阅函数：有人订阅时才轮询（AI 改了数据，界面 1.5 秒内跟上）。 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshLibrary()
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

export function snapshot(): State {
  return state
}
