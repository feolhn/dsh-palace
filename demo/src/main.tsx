/**
 * 演示站入口（#107）：过场动画式的产品演示，观众只看不操作。
 * 宫殿画布是插件的真实组件；字幕、对话、进度条由演示自己画。
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import notebookCss from '../../src/client/notebook/notebook.css?raw'
import palaceCss from '../../src/client/palace/palace.css?raw'
import fontsCss from '../../vendor/fonts/fonts.css?raw'
import { Palace } from '../../src/client/palace/Palace.tsx'
import { refreshPalace } from '../../src/client/palace/data.ts'
import { themeRoot, useThemeId } from '../../src/client/palace/theme.ts'
import { installFakeApi, setDemoData } from './fakeApi.ts'
import { apply, durationOf, enterScene, sceneLength, startState, stateAt, type DemoState } from './script.ts'
import { SCENES, START, START_ISO } from './scenes/index.ts'

// 皮肤图片和字体指向静态文件（构建时复制到 assets/）
;(globalThis as { __PALACE_STATIC_ASSETS__?: string }).__PALACE_STATIC_ASSETS__ = 'assets/'
installFakeApi()
const style = document.createElement('style')
style.textContent = [fontsCss.replace(/url\(fonts\//g, 'url(assets/fonts/'), notebookCss, palaceCss].join('\n')
document.head.appendChild(style)

const START_STATE = startState(START, START_ISO)
const VIEW_KEY = 'dsh-palace:view'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const TICK = 50

const FADE_MS = 900
const NO_LINES: DemoState['chat'] = []

/** 值变「空」时，把旧值再留 FADE_MS（这段时间 leaving = true，界面淡出）；变成新值则立刻换上 */
function useLinger<T>(value: T, empty: T): [T, boolean] {
  const isEmpty = (v: T) => v === empty || (Array.isArray(v) && v.length === 0)
  const [kept, setKept] = useState(value)
  useEffect(() => {
    if (!isEmpty(value)) { setKept(value); return }
    const t = setTimeout(() => setKept(empty), FADE_MS)
    return () => clearTimeout(t)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return [isEmpty(value) ? kept : value, isEmpty(value) && !isEmpty(kept)]
}

function Demo() {
  const [shown, setShown] = useState<DemoState>(() => stateAt(START_STATE, SCENES, 0))
  const [scene, setScene] = useState(0)
  const [elapsed, setElapsed] = useState(0) // 这一幕播了多少毫秒（暂停不计），进度条按它连续前进
  const [howto, setHowto] = useState(false)
  const pausedBeforeHowto = useRef(false) // 关掉安装面板后回到打开前的播放状态
  const [ended, setEnded] = useState(false) // 播完了：解开画布，观众可以自己逛
  const canvas = useRef<HTMLDivElement>(null)
  useEffect(() => { canvas.current?.toggleAttribute('inert', !ended) }, [ended])
  const [paused, setPaused] = useState(false)
  const [mount, setMount] = useState(0) // 换了它就重新挂载宫殿（跳转时用）
  const run = useRef(0) // 每次跳转加一，旧的播放循环看到就停
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const endedRef = useRef(false)
  endedRef.current = ended
  const stage = useRef<HTMLDivElement>(null)
  const skin = themeRoot(useThemeId())
  // 字幕和对话收起时先淡出再拿掉，不突然消失
  const [caption, captionOut] = useLinger(shown.caption, undefined)
  const [chat, chatOut] = useLinger(shown.chat, NO_LINES)

  const closeHowto = () => { setHowto(false); setPaused(pausedBeforeHowto.current) }

  /** 视图切换用插件自己的按钮，动画就是产品里真实的样子 */
  const toggleView = (iso: boolean) => {
    const btn = stage.current?.querySelector<HTMLButtonElement>('.mp-view-toggle:not(.mp-theme-toggle)')
    if (btn !== null && btn !== undefined && (btn.getAttribute('aria-pressed') === 'true') !== iso) btn.click()
  }

  /** 跳到第 index 幕的开头：瞬间重放前面的动作，重新挂载宫殿，然后从这里播 */
  const seek = async (index: number) => {
    const id = ++run.current
    setEnded(false)
    /** 等 ms 毫秒，暂停时不计时；跳转了就提前返回 false */
    const hold = async (ms: number) => {
      // 按真实流逝的时间扣：标签页在后台时浏览器会把定时器拖到一秒一次，按次数扣会慢几十倍
      let last = performance.now()
      for (let left = ms; left > 0;) {
        await sleep(TICK)
        if (run.current !== id) return false
        const now = performance.now(), dt = Math.min(now - last, left)
        last = now
        if (!pausedRef.current) { left -= dt; setElapsed(e => e + dt) }
      }
      return run.current === id
    }
    const s = stateAt(START_STATE, SCENES, index)
    localStorage.setItem(VIEW_KEY, s.iso ? 'iso' : 'flat')
    setDemoData(s)
    await refreshPalace()
    setShown(s); setScene(index); setElapsed(0); setMount(n => n + 1)
    await sleep(600)
    let state = s
    for (let i = index; i < SCENES.length; i++) {
      if (i !== index) { state = enterScene(state); setShown(state); setScene(i); setElapsed(0) }
      let done = 0 // 已播完的动作时长之和：每个动作结束时对齐一次，免得计时累计误差
      for (const a of SCENES[i].actions) {
        if (run.current !== id) return
        while (pausedRef.current) { if (!await hold(TICK)) return }
        state = apply(state, a)
        setDemoData(state)
        if (a.do === 'view') toggleView(a.iso)
        else void refreshPalace()
        setShown(state)
        if (!await hold(durationOf(a))) return
        done += durationOf(a)
        setElapsed(done)
      }
    }
    // 播完：收起字幕和对话，把画布让给观众
    if (run.current === id) { setShown(enterScene(state)); setEnded(true) }
  }

  useEffect(() => { void seek(0) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // 空格暂停 / 继续；焦点在按钮、链接上时留给它们（比如用键盘选进度条上的某一幕）
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || endedRef.current || (e.target as Element | null)?.closest?.('button, a, input, textarea, select')) return
      e.preventDefault()
      setPaused(p => !p)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  return (
    <div className={`dm-root ${skin.className}`} style={skin.style}>
      <div ref={stage} className={`dm-stage ${ended ? 'dm-ended' : ''}`} data-mp-host onClick={(e) => { if (e.isTrusted && !ended) setPaused(p => !p) }}>
        <div className="dm-canvas" ref={canvas}>
          <Palace key={mount} />
        </div>
      </div>
      {caption !== undefined && <div key={caption} className={`dm-caption ${captionOut ? 'dm-out' : ''}`}>{caption}</div>}
      {chat.length > 0 && (
        <div className={`dm-chat ${chatOut ? 'dm-out' : ''}`}>
          {chat.map((l, i) => <p key={i} className={`dm-line dm-${l.who}`}>{l.text}</p>)}
        </div>
      )}
      {ended && <button type="button" className="dm-replay" onClick={() => { setPaused(false); void seek(0) }}>↺ 重播</button>}
      {paused && !ended && <div className="dm-paused">已暂停 · 点画面继续</div>}
      <nav className="dm-bar" aria-label="演示进度">
        {SCENES.map((sc, i) => {
          const fill = i < scene ? 1 : i > scene ? 0 : Math.min(1, elapsed / sceneLength(sc))
          return (
            <button key={sc.id} type="button" className={`dm-seg ${i === scene ? 'dm-on' : ''}`} style={{ flexGrow: sceneLength(sc) }}
              onClick={() => { setPaused(false); void seek(i) }}>
              <span className="dm-fill" style={{ transform: `scaleX(${fill})` }} />
              <span className="dm-name">{sc.title}</span>
            </button>
          )
        })}
      </nav>
      {/* 安装：打开时暂停，看完关掉接着播 */}
      <button type="button" className="dm-install" aria-expanded={howto} onClick={() => { if (howto) closeHowto(); else { pausedBeforeHowto.current = pausedRef.current; setHowto(true); setPaused(true) } }}>安装</button>
      {howto && <HowTo onClose={closeHowto} />}
    </div>
  )
}

/** 安装：三个宿主并列（让人知道以后都能用），现在只有 DeepSeek Harness 能点开看步骤，和 README「安装」一节保持一致 */
const HOSTS = [
  { id: 'dsh', name: 'DeepSeek Harness', ready: true },
  { id: 'claude', name: 'Claude', ready: false },
  { id: 'chatgpt', name: 'ChatGPT', ready: false },
]

function HowTo({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string>()
  const [copied, setCopied] = useState(false)
  const copy = () => { void navigator.clipboard?.writeText('dsh-palace').then(() => setCopied(true)) }
  return (
    <section className="dm-howto" aria-label="安装">
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
      <button type="button" className="dm-copy dm-close" onClick={onClose}>关闭</button>
    </section>
  )
}

createRoot(document.getElementById('app')!).render(<Demo />)
