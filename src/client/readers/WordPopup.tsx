/**
 * 点词弹出的释义（#43）。样式移植自原型的 #word-lookup；内容来自系统词典，书的文字不会发到网上。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { lookupWord, openDictionary, type WordLookup } from '../api.ts'
import { formatEntry } from './lookup.ts'

export interface WordAnchor { word: string; left: number; right: number; top: number; bottom: number }

export function WordPopup({ anchor, onClose }: { anchor: WordAnchor; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const [result, setResult] = useState<WordLookup>()
  const [error, setError] = useState<string>()
  const [pos, setPos] = useState<{ left: number; top: number }>()

  useEffect(() => {
    let alive = true
    setResult(undefined); setError(undefined)
    lookupWord(anchor.word).then(r => alive && setResult(r), (e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [anchor.word])

  // 放在单词下方，放不下就放上方；不超出阅读区
  useLayoutEffect(() => {
    const el = ref.current, box = el?.offsetParent?.getBoundingClientRect()
    if (!el || !box) return
    const w = el.offsetWidth, h = el.offsetHeight
    const left = Math.max(8, Math.min(box.width - w - 8, (anchor.left + anchor.right) / 2 - box.left - w / 2))
    const below = anchor.bottom - box.top + 8
    const top = below + h <= box.height - 8 ? below : Math.max(8, anchor.top - box.top - h - 8)
    setPos({ left, top })
  }, [anchor, result, error])

  const entry = result?.definition ? formatEntry(result.definition) : undefined
  const base = result?.lemma ? formatEntry(result.lemma.definition) : undefined
  return (
    <aside ref={ref} className="rd-word" role="dialog" aria-label="单词释义" style={pos ?? { visibility: 'hidden' }}
      onPointerDown={e => e.stopPropagation()}>
      <div className="rd-word-head">
        <strong>{anchor.word}</strong>
        <button type="button" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      {error ? <p className="rd-word-note">{error}</p>
        : result === undefined ? <p className="rd-word-note">正在查词…</p>
          : !result.supported ? <p className="rd-word-note">查词用的是 macOS 自带的词典，这台电脑暂不支持。</p>
            : entry === undefined ? <p className="rd-word-note">系统词典里没有这个词。人名、地名、古旧拼写常常查不到。</p>
              : (
                <>
                  {entry.phonetic && <p className="rd-word-phonetic">{entry.phonetic}</p>}
                  <Senses entry={entry} />
                  {base && result.lemma && (<><p className="rd-word-lemma">原形 {result.lemma.word}</p><Senses entry={base} /></>)}
                  <button type="button" className="rd-word-more" onClick={() => void openDictionary(result.lemma?.word ?? anchor.word).catch(() => undefined)}>在「词典」中查看完整词条 ↗</button>
                </>
              )}
    </aside>
  )
}

function Senses({ entry }: { entry: ReturnType<typeof formatEntry> }) {
  return (
    <div className="rd-word-def">
      {entry.senses.map((s, i) => (
        <p key={i}>{s.text}{s.examples.map((x, j) => <span key={j} className="rd-word-eg">▸ {x}</span>)}</p>
      ))}
    </div>
  )
}
