/**
 * 演示站入口（#107）：一座只读的宫殿，访客自己逛。
 * 宫殿、阅览室是插件的真实组件，数据来自 demo/data/（构建时算成 assets/demo/data.json）。
 * 对话面板里是素材包里的聊天记录；访客可以试发一句，下面提示装插件。挪格子、换图标在内存里生效，刷新复原。
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import notebookCss from '../../src/client/notebook/notebook.css?raw'
import palaceCss from '../../src/client/palace/palace.css?raw'
import readerCss from '../../src/client/readers/reader.css?raw'
import fontsCss from '../../vendor/fonts/fonts.css?raw'
import { setDemoChat } from '../../src/client/chat/host.tsx'
import { Palace } from '../../src/client/palace/Palace.tsx'
import { themeRoot, useThemeId } from '../../src/client/palace/theme.ts'
import type { ChatLine, Snapshot } from '../snapshot.ts'
import { installFakeApi, loadDemo } from './fakeApi.ts'

// 皮肤图片和字体指向静态文件（构建时复制到 assets/）
;(globalThis as { __PALACE_STATIC_ASSETS__?: string }).__PALACE_STATIC_ASSETS__ = 'assets/'
installFakeApi()
const style = document.createElement('style')
style.textContent = [fontsCss.replace(/url\(fonts\//g, 'url(assets/fonts/'), notebookCss, palaceCss, readerCss].join('\n')
document.head.appendChild(style)

// 第一次来默认轴测视图：电弧只在轴测里画，一眼能看见格子连在一起
if (localStorage.getItem('dsh-palace:view') === null) localStorage.setItem('dsh-palace:view', 'iso')

/** 打开安装面板：对话里的「安装」、底栏「ⓘ」都发这个事件（不在同一棵组件树里，fakeApi.ts 里也用这个名字） */
const ASK_INSTALL = 'dm-ask-install'

/** 访客在演示里试发的话：只留在这个页面里（关掉面板再打开还在，刷新就没了） */
const tried = new Map<string, string[]>()

function DemoChat({ scope, lines }: { scope: string; lines: ChatLine[] | undefined }) {
  const [mine, setMine] = useState(() => tried.get(scope) ?? [])
  const [draft, setDraft] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [mine.length])
  const send = () => {
    const text = draft.trim()
    if (text === '') return
    const next = [...mine, text]
    tried.set(scope, next); setMine(next); setDraft('')
  }
  const empty = (lines === undefined || lines.length === 0) && mine.length === 0
  return (
    <div className="dm-chat-log">
      {empty
        ? <p className="mp-chat-note">这里还没有聊过。</p>
        : (
          <div className="dm-lines">
            {(lines ?? []).map((l, i) => <p key={i} className={`dm-line dm-${l.who}`}>{l.text}</p>)}
            {/* 试发的话照常显示；下面接一行系统提示，不冒充 AI 回答 */}
            {mine.map((t, i) => (
              <div key={`t${i}`} className="dm-tried">
                <p className="dm-line dm-user">{t}</p>
                <p className="dm-system">这是演示，AI 不会回复。装上插件就能真的聊。
                  <button type="button" className="dm-copy" onClick={() => dispatchEvent(new Event(ASK_INSTALL))}>安装</button></p>
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
      <form className="dm-composer" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea value={draft} rows={1} placeholder="想到什么，说一句…" aria-label="说一句"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
        <button type="submit" className="dm-send" aria-label="发送" disabled={draft.trim() === ''}>↑</button>
      </form>
    </div>
  )
}

/** 「ⓘ」：打开「关于 Palace」分组。用插件自己的交互：轴测视图里分组是摊开的，先切回平面，再在分组格子上点一下 */
const ABOUT = 'c_ffffff0000' // 「关于 Palace」分组的 id（demo/data/palace.json）：访客能改分组名，不能按标题找
async function openAbout(): Promise<void> {
    const flat = document.querySelector<HTMLButtonElement>('.mp-view-toggle[title^="切换到平面"]')
  if (flat !== null) { flat.click(); await new Promise(r => setTimeout(r, 900)) }
  const el = document.querySelector(`.mp-cell[data-cell-id="${ABOUT}"]`)
  if (el === null) return
  const r = el.getBoundingClientRect(), at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 99, bubbles: true }
  el.dispatchEvent(new PointerEvent('pointerdown', at))
  await new Promise(r => setTimeout(r, 50)) // 等宫殿记下这次按下，再抬起
  el.dispatchEvent(new PointerEvent('pointerup', at))
}

function Demo() {
  const skin = themeRoot(useThemeId())
  const [howto, setHowto] = useState<{ lead?: string }>()
  // 轻引导：一句话，点开第一个格子后就收起
  const [hint, setHint] = useState(true)
  useEffect(() => {
    const ask = () => setHowto({})
    const down = (e: PointerEvent) => { if ((e.target as Element | null)?.closest?.('.mp-cell')) setHint(false) }
    const about = () => { setHint(false); void openAbout() }
    addEventListener(ASK_INSTALL, ask)
    addEventListener('dm-about', about)
    addEventListener('pointerdown', down, true)
    return () => { removeEventListener(ASK_INSTALL, ask); removeEventListener('dm-about', about); removeEventListener('pointerdown', down, true) }
  }, [])

  return (
    <div className={`dm-root ${skin.className}`} style={skin.style}>
      <div className="dm-stage" data-mp-host><Palace /></div>
      {hint && <div className="dm-hint">点开任意格子看看</div>}
      <button type="button" className="dm-install" aria-expanded={howto !== undefined} onClick={() => setHowto(h => h === undefined ? {} : undefined)}>安装</button>
      {howto !== undefined && <HowTo lead={howto.lead} onClose={() => setHowto(undefined)} />}
    </div>
  )
}

/** 安装：三个宿主并列（让人知道以后都能用），现在只有 DeepSeek Harness 能点开看步骤，和 README「安装」一节保持一致 */
const HOSTS = [
  { id: 'dsh', name: 'DeepSeek Harness', ready: true },
  { id: 'claude', name: 'Claude', ready: false },
  { id: 'chatgpt', name: 'ChatGPT', ready: false },
]

function HowTo({ lead, onClose }: { lead?: string; onClose: () => void }) {
  const [open, setOpen] = useState<string>()
  const [copied, setCopied] = useState(false)
  const copy = () => { void navigator.clipboard?.writeText('dsh-palace').then(() => setCopied(true)) }
  return (
    <section className="dm-howto" aria-label="安装">
      {lead !== undefined && <p className="dm-lead">{lead}</p>}
      <h2>装到哪里</h2>
      {HOSTS.map(h => (
        <div key={h.id} className="dm-host">
          <button type="button" className="dm-host-name" disabled={!h.ready} aria-expanded={h.ready ? open === h.id : undefined}
            onClick={() => setOpen(o => o === h.id ? undefined : h.id)}>
            {h.name}<span className="dm-host-tag">{h.ready ? (open === h.id ? '收起' : '查看步骤') : '即将支持'}</span>
          </button>
          {h.id === 'dsh' && open === 'dsh' && (
            <ol>
              <li>还没有 Harness 的话，先到<a href="https://www.deepseek.com/harness/" target="_blank" rel="noreferrer">官网</a>下载桌面版并安装。</li>
              <li>打开 Harness，进入插件安装界面。</li>
              <li>输入 <code>dsh-palace</code><button type="button" className="dm-copy" onClick={copy}>{copied ? '已复制' : '复制'}</button>，点安装。</li>
              <li>完全退出 Harness，再重新打开。</li>
              <li>左侧导航出现「Memory Palace」，就装好了。</li>
            </ol>
          )}
        </div>
      ))}
      {/* 请喜欢的人去 GitHub 点星：不说「开源」，说「免费、代码公开」，小白也看得懂 */}
      <p className="dm-star">Memory Palace 免费，代码全部公开在 GitHub。喜欢的话，去点一颗 ⭐，这是对我们最大的鼓励。
        <a href="https://github.com/feolhn/dsh-palace" target="_blank" rel="noreferrer">去 GitHub 点星 ↗</a></p>
      <button type="button" className="dm-copy dm-close" onClick={onClose}>关闭</button>
    </section>
  )
}


void loadDemo().then((d: Snapshot) => {
  setDemoChat(scope => <DemoChat key={scope} scope={scope} lines={d.chats[scope]} />)
  createRoot(document.getElementById('app')!).render(<Demo />)
})
