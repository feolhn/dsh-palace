/**
 * 书架根组件。两个入口共用：
 * - 对话右侧栏（有 sessionId，可以让 AI 干活）
 * - 左侧导航「学习」全屏页（没有对话，只浏览和打勾）
 */
import { useEffect, useState } from 'react'
import { setActive } from '../api.ts'
import { AddMaterial } from './AddMaterial.tsx'
import { useLibrary } from './common.tsx'
import { Home } from './Home.tsx'
import { MaterialView, type MaterialTab } from './MaterialView.tsx'
import { PagePicker } from './PagePicker.tsx'

type View =
  | { name: 'home' }
  | { name: 'add'; subjectId?: string }
  | { name: 'material'; id: string; tab: MaterialTab }
  | { name: 'picker'; id: string }

/** 每个对话记住自己停在哪个界面（切换对话、收起侧栏再打开都不丢）。 */
const remembered = new Map<string, View>()

export function App({ sessionId, wide = false }: { sessionId?: string; wide?: boolean }) {
  const key = sessionId ?? '__panel__'
  const [view, setViewState] = useState<View>(() => remembered.get(key) ?? { name: 'home' })
  const setView = (next: View) => { remembered.set(key, next); setViewState(next) }
  const { library, error, dataDir } = useLibrary()

  // 告诉 Host：这个对话当前打开的是哪本资料（AI 记错题时默认记到这本）
  const activeId = view.name === 'material' || view.name === 'picker' ? view.id : null
  useEffect(() => {
    if (sessionId !== undefined) void setActive(sessionId, activeId).catch(() => undefined)
  }, [sessionId, activeId])

  const className = `dshs-root ${wide ? 'dshs-wide' : ''}`
  if (library === undefined) {
    return <div className={className}>{error ? <div className="dshs-error">书架加载失败：{error}</div> : <div className="dshs-empty">加载中…</div>}</div>
  }

  const material = 'id' in view ? library.materials.find(m => m.id === view.id) : undefined
  let body
  if (view.name === 'add') {
    body = <AddMaterial library={library} subjectId={view.subjectId} onDone={id => setView({ name: 'material', id, tab: 'outline' })} onCancel={() => setView({ name: 'home' })} />
  } else if (view.name === 'material' && material) {
    body = (
      <MaterialView library={library} material={material} tab={view.tab}
        onTab={tab => setView({ ...view, tab })}
        onBack={() => setView({ name: 'home' })}
        onPick={() => setView({ name: 'picker', id: material.id })} />
    )
  } else if (view.name === 'picker' && material) {
    body = <PagePicker material={material} sessionId={sessionId} onDone={() => setView({ name: 'material', id: material.id, tab: 'outline' })} onCancel={() => setView({ name: 'material', id: material.id, tab: 'outline' })} />
  } else {
    body = <Home library={library} onOpen={id => setView({ name: 'material', id, tab: 'outline' })} onAdd={subjectId => setView({ name: 'add', subjectId })} />
  }

  return (
    <div className={className}>
      {body}
      {view.name === 'home' && dataDir && (
        <div className="dshs-small dshs-muted" style={{ marginTop: 32 }}>
          数据保存在 {dataDir}（普通 JSON 文件，可以自己备份）
        </div>
      )}
    </div>
  )
}
