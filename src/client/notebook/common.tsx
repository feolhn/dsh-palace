/** 笔记本里的通用小组件和 hook。 */
import { useEffect, useState, type ReactNode } from 'react'
import { palaceOp } from '../palace/data.ts'

/** 执行异步操作，记录忙碌状态和错误信息。 */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

/** 写操作的简写：出错时交给 onError。返回是否成功，调用方只在成功后清空输入。 */
export function useOp(onError: (message: string) => void) {
  return (op: string, args: Record<string, unknown>): Promise<boolean> =>
    palaceOp(op, args).then(() => true, (e: Error) => { onError(e.message); return false })
}

/** 需要点两次的危险按钮（Electron 里不用 window.confirm）。 */
export function ConfirmButton({ label, confirmLabel = '再点一次确认', onConfirm }: { label: string; confirmLabel?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className="nb-link nb-danger" onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmLabel : label}
    </button>
  )
}

/** 全屏放大层，点击任意处或按 Esc 关闭。 */
export function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return <div className="nb-overlay" onClick={onClose}>{children}</div>
}
