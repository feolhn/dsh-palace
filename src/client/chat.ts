/**
 * 书架 → 对话：在当前对话里替用户发一条消息（可带图片），让 AI 接着干活。
 * 用到的是 Harness 前端的会话接口；发图片用的是非公开方法，失败时退回纯文字。
 */

/** 插件 apply 时保存的前端上下文（只取需要的部分）。 */
interface ClientCtx {
  get(name: string): unknown
}

interface ScopedConversation {
  send(text: string): Promise<void>
  createDrafts?(sessionId: string, files: readonly File[], uploadImages: boolean): readonly { id: string }[]
  input?: {
    for(actx: unknown): {
      setDraft(text: string): void
      addAttachments(ids: readonly string[]): boolean
      submit(): void
    }
  }
}

let root: ClientCtx | undefined

export function bindChat(ctx: ClientCtx): void {
  root = ctx
}

function scope(sessionId: string): ClientCtx | undefined {
  const sessions = root?.get('sessions') as { scope?(id: string): unknown } | undefined
  return sessions?.scope?.(sessionId) as ClientCtx | undefined
}

/** Session scope 的服务通过 get 获取，不能直接读属性（Cordis 会检查 inject）。 */
function conversationOf(ctx: ClientCtx | undefined): ScopedConversation | undefined {
  return ctx?.get('conversation') as ScopedConversation | undefined
}

/** 能不能往这个对话发消息（左侧导航的全屏书架没有对话）。 */
export function canChat(sessionId: string | undefined): sessionId is string {
  return sessionId !== undefined && conversationOf(scope(sessionId)) !== undefined
}

export async function sendText(sessionId: string, text: string): Promise<void> {
  const conversation = conversationOf(scope(sessionId))
  if (conversation === undefined) throw new Error('找不到当前对话')
  await conversation.send(text)
}

/**
 * 发送文字 + 图片。返回 false 表示当前版本不支持程序化附图（调用方改走纯文字）。
 */
export function sendWithImages(sessionId: string, text: string, files: File[]): boolean {
  const actx = scope(sessionId)
  const conversation = conversationOf(actx)
  if (conversation?.createDrafts === undefined || conversation.input === undefined) return false
  try {
    const drafts = conversation.createDrafts(sessionId, files, true)
    const input = conversation.input.for(actx)
    input.setDraft(text)
    if (!input.addAttachments(drafts.map(d => d.id))) return false
    input.submit()
    return true
  } catch (error) {
    console.warn('[dsh-palace] 附图发送失败，改用纯文字', error)
    return false
  }
}

/** 把一句话放进输入框（不发送），用户可以接着改。返回 false 表示当前版本不支持。 */
export function setDraft(sessionId: string, text: string): boolean {
  const actx = scope(sessionId)
  const input = conversationOf(actx)?.input
  if (input === undefined) return false
  try { input.for(actx).setDraft(text); return true } catch { return false }
}
