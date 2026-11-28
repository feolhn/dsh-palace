/**
 * 演示站入口（#107）：一座只读的宫殿，访客自己逛。
 * 宫殿、阅览室是插件的真实组件，数据来自 demo/data/（构建时算成 assets/demo/data.json）。
 * 对话面板里是素材包里的聊天记录；点输入框提示装插件，打开安装面板。
 */
import { useEffect, useState } from 'react'
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

/** 对话面板里点输入框 → 打开安装面板（两处不在同一棵组件树里，用事件传） */
const ASK_INSTALL = 'dm-ask-install'

function DemoChat({ lines }: { lines: ChatLine[] | undefined }) {
  return (
    <div className="dm-chat-log">
      {lines === undefined || lines.length === 0
        ? <p className="mp-chat-note">这里还没有聊过。</p>
        : <div className="dm-lines">{lines.map((l, i) => <p key={i} className={`dm-line dm-${l.who}`}>{l.text}</p>)}</div>}
      <button type="button" className="dm-composer" onClick={() => dispatchEvent(new Event(ASK_INSTALL))}>
        想到什么，说一句…<span className="dm-send">↑</span>
      </button>
    </div>
  )
}

function Demo() {
  const skin = themeRoot(useThemeId())
  const [howto, setHowto] = useState<{ lead?: string }>()
  // 轻引导：一句话，点开第一个格子后就收起
  const [hint, setHint] = useState(true)
  useEffect(() => {
    const ask = () => setHowto({ lead: '装上插件后，就能和它聊。' })
    const down = (e: PointerEvent) => { if ((e.target as Element | null)?.closest?.('.mp-cell')) setHint(false) }
    addEventListener(ASK_INSTALL, ask)
    addEventListener('pointerdown', down, true)
    return () => { removeEventListener(ASK_INSTALL, ask); removeEventListener('pointerdown', down, true) }
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
  setDemoChat(scope => <DemoChat lines={d.chats[scope]} />)
  createRoot(document.getElementById('app')!).render(<Demo />)
})
