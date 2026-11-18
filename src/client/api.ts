/**
 * 前端调用 Host 接口的小工具。路径相对应用根（桌面版是 dsh-app://，网页版是 http://localhost）。
 * 宫殿数据的读取和刷新在 palace/data.ts。
 */
export function apiUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(`api/dsh-shelf/${path}`, document.baseURI)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return url.href
}

export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({ ok: false, error: `请求失败（HTTP ${response.status}）` })) as { ok: boolean; error?: string } & T
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`)
  return body
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  return readJson<T>(await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function pickBook(): Promise<string | null | undefined> {
  return (await post<{ path: string | null | undefined }>('pick-file', {})).path
}

/** 用系统程序打开原文；视频传 sectionId 跳到那一集。 */
export async function openSource(id: string, sectionId?: string): Promise<void> {
  await post('open', { id, sectionId })
}

export async function openDataDir(): Promise<void> {
  await post('open', { target: 'dataDir' })
}

export async function setActive(sessionId: string, itemId: string | null): Promise<void> {
  await post('active', { sessionId, itemId })
}

export async function pageTexts(id: string, pages: number[]): Promise<{ pages: { page: number; text: string }[]; scanned: number[] }> {
  return readJson(await fetch(apiUrl('page-text', { id, pages: pages.join(',') })))
}

/** 宫殿 AI 对话所在的工作区目录（绝对路径，只用来新建会话）。 */
export async function chatWorkspace(): Promise<string> {
  return (await readJson<{ cwd: string }>(await fetch(apiUrl('chat-workspace')))).cwd
}

export interface WordLookup { supported: boolean; definition: string | null; lemma?: { word: string; definition: string } }

/** 查词（#43）：系统自带词典。 */
export async function lookupWord(word: string): Promise<WordLookup> {
  return readJson(await fetch(apiUrl('lookup', { word })))
}

export async function openDictionary(word: string): Promise<void> {
  await post('open-dictionary', { word })
}
