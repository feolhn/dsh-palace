/**
 * 宫殿里的 AI 对话：嵌入 Harness 原生的对话界面（消息列表 + 输入框），背后是一个真实的 Harness 会话。
 * 做法照 Harness 自带的 subagent 侧栏（dsh-client-ui-subagent / sidebar-chat）：
 * 1. 全屏面板的 slot 声明一个 session 作用域的子 slot `dsh-shelf.chat`，渲染器会给面板注入 SessionProvider；
 * 2. 用 sessions.retain 拿住会话，SessionProvider 包住子 slot；
 * 3. 子 slot 里渲染 `conversation.content`（embedded 模式），就是原生的聊天界面。
 * 这些都是 Harness 的非公开接口，版本变了可能失效：拿不到时界面显示提示，不影响宫殿其他功能。
 */
import { createContext, useContext, type ReactNode } from 'react'

/** 子 slot 名：一个 session 作用域的对话位置。 */
export const CHAT_SLOT = 'dsh-shelf.chat'

/** 会话引用：用完必须 release。 */
export interface SessionReference { readonly sessionId: string; release(): void }

export interface SessionsService {
  create(opts?: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<string>
  retain(target: string, options: { source: string; signal?: AbortSignal }): SessionReference
  list?: { getSnapshot(): { byId: Record<string, { archived?: boolean } | undefined> } }
}

/** 全屏面板拿到的渲染能力（来自 slot 渲染器注入的 props）。 */
export interface ChatSlots {
  SessionProvider: (props: { session: SessionReference; children?: ReactNode }) => ReactNode
  renderSlot: (name: string, props: Record<string, unknown>) => ReactNode
}

/** 工作区服务：把数据目录登记成工作区（重复登记会返回同一个）。 */
export interface WorkspacesService {
  create(input: { path: string }): Promise<{ workspaceId: string; title?: string }>
  rename?(workspaceId: string, title: string): Promise<unknown>
}

let getService: ((name: string) => unknown) | undefined

/** 记下前端上下文的 get；服务用到时再取（插件加载顺序可能早于这些服务）。 */
export function bindSessions(get: (name: string) => unknown): void {
  getService = get
}

export function workspacesService(): WorkspacesService | undefined {
  const w = getService?.('workspaces') as Partial<WorkspacesService> | undefined
  return typeof w?.create === 'function' ? w as WorkspacesService : undefined
}

export function sessionsService(): SessionsService | undefined {
  const s = getService?.('sessions') as Partial<SessionsService> | undefined
  return typeof s?.create === 'function' && typeof s.retain === 'function' ? s as SessionsService : undefined
}

const ChatSlotsContext = createContext<ChatSlots | undefined>(undefined)
export const ChatSlotsProvider = ChatSlotsContext.Provider
export const useChatSlots = () => useContext(ChatSlotsContext)

/** 子 slot 里的内容：照抄 Harness 的 ConversationSlotPanel，算出 phase 后渲染原生对话。 */
interface PanelProps {
  sessionId: string
  useSession: <T>(select: (s: SessionState) => T) => T
  useConversation: <T>(select: (c: { activeTargets: { size: number } }) => T) => T
  useSessions: <T>(select: (s: { byId: Record<string, { blank?: boolean } | undefined> }) => T) => T
  renderFactorySlot: (name: string, props: Record<string, unknown>, options: { slots: Record<string, unknown> }) => ReactNode
}
interface SessionState { blank: boolean; awaitingFirstTurn: boolean; running: boolean; promptAttempted: boolean; openState: string }

function FixedChatView(props: { renderSlot: (name: string, p: Record<string, unknown>) => ReactNode }) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

export function ChatSlotPanel({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }: PanelProps) {
  const session = useSession(v => v)
  const conversation = useConversation(v => v)
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions(s => s.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  // 不用 Harness 的首页大标题和工作区选择（宫殿的对话固定在 Memory Palace 工作区），空对话也按普通对话显示
  const phase = settling ? 'settling' : 'active'
  return <>{renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero: false }, { slots: { views: FixedChatView } })}</>
}
