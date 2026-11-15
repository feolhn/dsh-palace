/**
 * 盖在当前面板上的浮层：挂到最近的 [data-mp-host]（全屏宫殿 / 右侧栏的根容器），
 * 不盖住 Harness 自己的界面（窗口按钮、导航）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PanelOverlay({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => { setHost(anchor.current?.closest<HTMLElement>('[data-mp-host]') ?? document.body) }, [])
  return <><span ref={anchor} hidden />{host && createPortal(children, host)}</>
}
