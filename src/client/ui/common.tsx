/** 通用小组件和 hook。 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { snapshot, subscribe } from '../api.ts'

export function useLibrary() {
  return useSyncExternalStore(subscribe, snapshot)
}

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

/** 封面颜色：按标题哈希取一组低饱和色，同一本书颜色固定。 */
const COVERS = ['#5b6f8f', '#7a5c61', '#4f7a6a', '#8a6d3b', '#5e5a8a', '#3f6b7f', '#7d5a7a', '#6b7350', '#8a5a44', '#4a6458']
export function coverColor(title: string): string {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return COVERS[h % COVERS.length]
}

/** 需要点两次的危险按钮（Electron 里不用 window.confirm）。 */
export function ConfirmButton({ label, confirmLabel = '再点一次确认', onConfirm, disabled }: {
  label: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className="dshs-btn dshs-btn-danger"
      disabled={disabled}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}

/** 全屏放大层，点击任意处关闭。 */
export function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(<div className="dshs-overlay" onClick={onClose}>{children}</div>, document.body)
}

/** 单行文本表单：输入 + 确定/取消。 */
export function TextForm({ initial = '', placeholder, submitLabel = '确定', onSubmit, onCancel, extra }: {
  initial?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => Promise<unknown>
  onCancel: () => void
  extra?: ReactNode
}) {
  const [value, setValue] = useState(initial)
  const { busy, error, run } = useAction()
  const submit = async () => {
    if (value.trim() === '') return
    if (await run(() => onSubmit(value.trim()))) onCancel()
  }
  return (
    <div className="dshs-form">
      <div className="dshs-row">
        <input
          className="dshs-input dshs-input-grow"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={e => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
      </div>
      {extra}
      <div className="dshs-row">
        <button type="button" className="dshs-btn dshs-btn-primary" disabled={busy || value.trim() === ''} onClick={() => void submit()}>{submitLabel}</button>
        <button type="button" className="dshs-btn dshs-btn-ghost" onClick={onCancel}>取消</button>
      </div>
      {error && <div className="dshs-error">{error}</div>}
    </div>
  )
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return <div className="dshs-progress"><i style={{ width: `${pct}%` }} /></div>
}
