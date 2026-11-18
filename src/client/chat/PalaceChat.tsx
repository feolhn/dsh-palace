/**
 * 宫殿里的 AI 对话面板。宫殿一个对话、每本书 / 笔记各一个对话，都是真实的 Harness 会话：
 * 用户配好的模型、宫殿的工具（加书、记卡片、存灵感……）都能用，左侧会话列表里也能找到、接着聊。
 * 会话建在数据目录这个工作区下；哪个位置对应哪个会话记在本机（localStorage），点「新对话」换一个。
 */
import { useEffect, useRef, useState } from 'react'
import { chatWorkspace, setActive } from '../api.ts'
import { CHAT_SLOT, ChatIntroProvider, sessionsService, useChatSlots, workspacesService, type SessionReference } from './host.tsx'

const STORE_KEY = 'dsh-shelf:chat-sessions'

function remembered(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string> } catch { return {} }
}

function remember(scope: string, sessionId: string): void {
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...remembered(), [scope]: sessionId }))
}

/** 数据目录登记成工作区「Memory Palace」，宫殿的对话都在它下面；拿不到工作区服务时退回只传目录。 */
async function workspaceFor(): Promise<{ workspaceId: string } | { cwd: string }> {
  const cwd = await chatWorkspace()
  const workspaces = workspacesService()
  if (workspaces === undefined) return { cwd }
  const ws = await workspaces.create({ path: cwd })
  if (ws.title !== 'Memory Palace') void workspaces.rename?.(ws.workspaceId, 'Memory Palace').catch(() => undefined)
  return { workspaceId: ws.workspaceId }
}

/** 等会话列表加载完成（最多 5 秒）；拿不到列表或超时返回 undefined。 */
async function readyList(sessions: NonNullable<ReturnType<typeof sessionsService>>) {
  const list = sessions.list
  if (list === undefined) return undefined
  const ready = () => { const snap = list.getSnapshot(); return snap.phase === undefined || snap.phase === 'ready' ? snap : undefined }
  if (ready() !== undefined || list.subscribe === undefined) return ready()
  return new Promise<ReturnType<typeof ready>>((resolve) => {
    const done = () => { stop(); clearTimeout(timer); resolve(ready()) }
    const stop = list.subscribe!(() => { if (ready() !== undefined) done() })
    const timer = setTimeout(done, 5000)
  })
}

/** 这个位置的会话：记过且还在（没被删 / 归档）就接着用，否则新建一个。 */
async function sessionFor(scope: string, fresh: boolean): Promise<string> {
  const sessions = sessionsService()
  if (sessions === undefined) throw new Error('unsupported')
  const known = fresh ? undefined : remembered()[scope]
  if (known !== undefined) {
    const list = await readyList(sessions)
    // 列表加载完成（ready，包括空列表）才能断定会话已被删；一直没加载完就相信记下的 id
    const summary = list?.byId[known]
    if (list === undefined ? true : summary !== undefined && summary.archived !== true) return known
  }
  const id = await sessions.create(await workspaceFor())
  remember(scope, id)
  return id
}

export function PalaceChat({ scope, itemId, heading, context, prompts, dock, onSession, onClose }: {
  /** 'palace' 或格子 id：决定用哪个会话 */
  scope: string
  /** 书 / 笔记的 id：AI 记卡片时默认记到这里 */
  itemId?: string
  heading: string
  context?: string
  /** 空对话时可以点的开头 */
  prompts: readonly string[]
  /** 阅览室旁边的对话：贴在阅览室左边（屏幕坐标）。不给就是靠右的面板。 */
  dock?: { left: number; top: number; width: number; height: number }
  /** 当前对话的会话 id（打开 / 换新对话 / 关闭时通知），给旁边的笔记本发消息用 */
  onSession?: (sessionId: string | undefined) => void
  onClose: () => void
}) {
  const slots = useChatSlots()
  const [reference, setReference] = useState<SessionReference>()
  const [error, setError] = useState<string>()
  const [generation, setGeneration] = useState(0)
  const fresh = useRef(false)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession

  useEffect(() => {
    if (slots === undefined || sessionsService() === undefined) return
    let alive = true
    let held: SessionReference | undefined
    const abort = new AbortController()
    setError(undefined)
    void sessionFor(scope, fresh.current).then((id) => {
      fresh.current = false
      if (!alive) return
      held = sessionsService()!.retain(id, { source: 'dshShelf', signal: abort.signal })
      setReference(held)
      onSessionRef.current?.(id)
      void setActive(id, itemId ?? null).catch(() => undefined)
    }).catch((e: Error) => { if (alive) setError(e.message) })
    return () => {
      alive = false
      abort.abort()
      held?.release()
      setReference(undefined)
      onSessionRef.current?.(undefined)
    }
  }, [scope, itemId, generation, slots])

  const unsupported = slots === undefined || sessionsService() === undefined || error === 'unsupported'

  return (
    <aside className={`mp-chat ${dock ? 'mp-chat-dock' : ''}`} aria-label={heading} style={dock}
      onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <header className="mp-chat-head">
        <div>
          <span className="mp-eyebrow">A CONVERSATION</span>
          <h2>{heading}</h2>
        </div>
        <button type="button" className="mp-text-btn" title="开始一个新对话（旧对话仍在左侧会话列表里）"
          onClick={() => { fresh.current = true; setGeneration(g => g + 1) }}>新对话</button>
        <button type="button" className="mp-chat-close" aria-label="收起对话" onClick={onClose}>−</button>
      </header>
      <div className="mp-chat-body">
        {unsupported
          ? <p className="mp-chat-note">当前版本的 Harness 不支持在这里聊天。可以在对话标题栏点书本按钮，从右侧栏使用宫殿。</p>
          : error
            ? <p className="mp-chat-note">对话没打开：{error}</p>
            : reference === undefined
              ? <p className="mp-chat-note">正在打开对话…</p>
              : <ChatIntroProvider value={{ context, prompts }}>
                <slots.SessionProvider session={reference}>{slots.renderSlot(CHAT_SLOT, {})}</slots.SessionProvider>
              </ChatIntroProvider>}
      </div>
    </aside>
  )
}
