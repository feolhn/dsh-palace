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

function Demo() {
  const [shown, setShown] = useState<DemoState>(() => stateAt(START_STATE, SCENES, 0))
  const [scene, setScene] = useState(0)
  const [elapsed, setElapsed] = useState(0) // 这一幕播了多少毫秒（暂停不计），进度条按它连续前进
  const [howto, setHowto] = useState(false)
  const [paused, setPaused] = useState(false)
  const [mount, setMount] = useState(0) // 换了它就重新挂载宫殿（跳转时用）
  const run = useRef(0) // 每次跳转加一，旧的播放循环看到就停
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const stage = useRef<HTMLDivElement>(null)
  const skin = themeRoot(useThemeId())

  /** 视图切换用插件自己的按钮，动画就是产品里真实的样子 */
  const toggleView = (iso: boolean) => {
    const btn = stage.current?.querySelector<HTMLButtonElement>('.mp-view-toggle:not(.mp-theme-toggle)')
    if (btn !== null && btn !== undefined && (btn.getAttribute('aria-pressed') === 'true') !== iso) btn.click()
  }

  /** 跳到第 index 幕的开头：瞬间重放前面的动作，重新挂载宫殿，然后从这里播 */
  const seek = async (index: number) => {
    const id = ++run.current
    /** 等 ms 毫秒，暂停时不计时；跳转了就提前返回 false */
    const hold = async (ms: number) => {
      for (let left = ms; left > 0;) {
        await sleep(TICK)
        if (run.current !== id) return false
        if (!pausedRef.current) { left -= TICK; setElapsed(e => e + TICK) }
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
  }

  useEffect(() => { void seek(0) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // 空格暂停 / 继续；焦点在按钮、链接上时留给它们（比如用键盘选进度条上的某一幕）
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || (e.target as Element | null)?.closest?.('button, a, input, textarea, select')) return
      e.preventDefault()
      setPaused(p => !p)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  return (
    <div className={`dm-root ${skin.className}`} style={skin.style}>
      <div ref={stage} className="dm-stage" data-mp-host onClick={(e) => { if (e.isTrusted) setPaused(p => !p) }}>
        <div className="dm-canvas" ref={el => el?.setAttribute('inert', '')}>
          <Palace key={mount} />
        </div>
      </div>
      {shown.caption !== undefined && <div key={shown.caption} className="dm-caption">{shown.caption}</div>}
      {shown.chat.length > 0 && (
        <div className="dm-chat">
          {shown.chat.map((l, i) => <p key={i} className={`dm-line dm-${l.who}`}>{l.text}</p>)}
        </div>
      )}
      {paused && <div className="dm-paused">已暂停 · 点画面继续</div>}
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
      <button type="button" className="dm-install" aria-expanded={howto} onClick={() => { setHowto(h => !h); setPaused(true) }}>安装</button>
      {howto && <HowTo onClose={() => setHowto(false)} />}
    </div>
  )
}

/** 安装步骤，和 README「安装」一节保持一致 */
function HowTo({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { void navigator.clipboard?.writeText('dsh-palace').then(() => setCopied(true)) }
  return (
    <section className="dm-howto" aria-label="安装步骤">
      <h2>在 DeepSeek Harness 里安装</h2>
      <ol>
        <li>还没有 Harness 的话，先到<a href="https://www.deepseek.com/harness/" target="_blank" rel="noreferrer">官网</a>下载桌面版并安装。</li>
        <li>打开 Harness，进入插件安装界面。</li>
        <li>输入 <code>dsh-palace</code><button type="button" className="dm-copy" onClick={copy}>{copied ? '已复制' : '复制'}</button>，点安装。</li>
        <li>完全退出 Harness，再重新打开。</li>
        <li>左侧导航出现「Memory Palace」，就装好了。</li>
      </ol>
      <p className="dm-soon">Claude、ChatGPT 即将支持。</p>
      <button type="button" className="dm-copy dm-close" onClick={onClose}>关闭</button>
    </section>
  )
}

createRoot(document.getElementById('app')!).render(<Demo />)
