/**
 * dsh-shelf（Memory Palace）前端入口。注册四个位置：
 * 1. 右侧栏页面：当前格子的笔记本（和对话并排，AI 功能在这里用）
 * 2. 右侧栏引导页里的入口卡片
 * 3. 对话标题栏右侧的书本按钮
 * 4. 左侧导航「学习」→ 全屏宫殿（v0.2，Memory Palace）
 */
import notebookCss from './notebook/notebook.css?raw'
import palaceCss from './palace/palace.css?raw'
import shareCss from './share/share.css?raw'
import readerCss from './readers/reader.css?raw'
import { Palace } from './palace/Palace.tsx'
import { Component, type ReactNode } from 'react'
import { bindChat } from './chat.ts'
import { Sidebar } from './notebook/Sidebar.tsx'

export const name = 'dsh-shelf'
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight']

const TAB_ID = 'dsh-shelf/shelf'
const TAB_KIND = 'dshShelf'
const PANEL_ID = 'dsh-shelf'

// 前端上下文只用到少量方法，这里给出最小类型
interface ClientContext {
  get(name: string): unknown
  effect(execute: () => () => void, label?: string): void
  slots: {
    inject(name: string, callback: () => (() => void) | void): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  sidebarRightTabs: { register(definition: Record<string, unknown>): () => void }
  sidebarRight: { openTab(kind: string, options?: Record<string, unknown>): void }
}

function BookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H19v-5" />
      <path d="M9 7h6" />
    </svg>
  )
}

/** 界面出错时显示提示和「重新加载」，而不是整页空白。 */
class Guard extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('[dsh-shelf]', error) }
  render() {
    if (this.state.error === undefined) return this.props.children
    return (
      <div style={{ padding: 32, fontSize: 13, lineHeight: 1.8 }}>
        <p>界面出错了：{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: undefined })}>重新加载</button>
      </div>
    )
  }
}

function ShelfTab(props: { sessionId?: string }) {
  return <Guard><Sidebar sessionId={props.sessionId} /></Guard>
}

function MainPanel() {
  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <Guard><Palace /></Guard>
    </div>
  )
}

function HeaderButton(props: { openShelf?: () => void }) {
  return (
    <button
      type="button"
      title="Memory Palace"
      aria-label="Memory Palace"
      onClick={() => props.openShelf?.()}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
        border: 0, borderRadius: 8, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <BookIcon />
    </button>
  )
}

function PanelIcon({ size }: { size: number }) {
  return <BookIcon size={size} />
}

export function apply(ctx: ClientContext): void {
  bindChat(ctx)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-shelf'
    style.textContent = [notebookCss, palaceCss, shareCss, readerCss].join('\n')
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-shelf: styles')

  const openShelf = () => ctx.sidebarRight.openTab(TAB_KIND)

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => 'Memory Palace',
    guide: [{ id: 'dsh-shelf', order: 40, title: () => 'Memory Palace', description: () => '书的进度、卡片和灵感' }],
  }), 'dsh-shelf: tab type')

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, ShelfTab))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-shelf',
    order: -6,
    inject: () => ({ openShelf }),
  }, HeaderButton))

  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, MainPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: 'Memory Palace',
  }, PanelIcon))
}
