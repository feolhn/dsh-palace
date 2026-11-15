// react-dom 由 Harness 提供（external），这里只声明用到的 createPortal
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactPortal
}
