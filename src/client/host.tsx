/**
 * 盖在当前面板上的浮层：挂到最近的 [data-mp-host]（全屏宫殿 / 右侧栏的根容器），
 * 不盖住 Harness 自己的界面（窗口按钮、导航）。
 *
 * 注意：portal 里的事件仍会沿 React 组件树冒泡到父组件（比如宫殿的拖动），
 * 所以在浮层边界把指针和键盘以外的点击事件拦住。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PanelOverlay({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setHost(anchor.current?.closest<HTMLElement>('[data-mp-host]') ?? document.body) }, [])
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  const layer = (
    <div style={{ display: 'contents' }} onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onClick={stop} onWheel={stop}>
      {children}
    </div>
  )
  return <><span ref={anchor} hidden />{host && createPortal(layer, host)}</>
}
