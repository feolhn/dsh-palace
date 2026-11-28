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

function Demo() {
  const [shown, setShown] = useState<DemoState>(() => stateAt(START_STATE, SCENES, 0))
  const [scene, setScene] = useState(0)
  const [step, setStep] = useState(0) // 这一幕已经做完几个动作
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
    const s = stateAt(START_STATE, SCENES, index)
    localStorage.setItem(VIEW_KEY, s.iso ? 'iso' : 'flat')
    setDemoData(s)
    await refreshPalace()
    setShown(s); setScene(index); setStep(0); setMount(n => n + 1)
    await sleep(600)
    let state = s
    for (let i = index; i < SCENES.length; i++) {
      if (i !== index) { state = enterScene(state); setShown(state); setScene(i); setStep(0) }
      for (const [k, a] of SCENES[i].actions.entries()) {
        while (pausedRef.current && run.current === id) await sleep(100)
        if (run.current !== id) return
        state = apply(state, a)
        setDemoData(state)
        if (a.do === 'view') toggleView(a.iso)
        else void refreshPalace()
        setShown(state)
        await sleep(durationOf(a))
        if (run.current !== id) return
        setStep(k + 1)
      }
    }
  }

  useEffect(() => { void seek(0) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === ' ') { e.preventDefault(); setPaused(p => !p) } }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  return (
    <div className={`dm-root ${skin.className}`} style={skin.style}>
      <div ref={stage} className="dm-stage" data-mp-host onClick={(e) => { if (e.isTrusted) setPaused(p => !p) }}>
        <Palace key={mount} />
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
          const fill = i < scene ? 1 : i > scene ? 0 : SCENES[i].actions.slice(0, step).reduce((t, a) => t + durationOf(a), 0) / sceneLength(sc)
          return (
            <button key={sc.id} type="button" className={`dm-seg ${i === scene ? 'dm-on' : ''}`} style={{ flexGrow: sceneLength(sc) }}
              onClick={() => { setPaused(false); void seek(i) }}>
              <span className="dm-fill" style={{ transform: `scaleX(${fill})` }} />
              <span className="dm-name">{sc.title}</span>
            </button>
          )
        })}
      </nav>
      <a className="dm-install" href="https://github.com/feolhn/dsh-palace#安装">安装</a>
    </div>
  )
}

createRoot(document.getElementById('app')!).render(<Demo />)
