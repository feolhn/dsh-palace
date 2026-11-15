/**
 * 从宫殿直接进入阅读（点格子上的月亮）：EPUB 在插件里打开，PDF 和视频用系统程序打开。
 */
import { useEffect } from 'react'
import { progressOf } from '../../shared/palace.ts'
import { openSource } from '../api.ts'
import { EpubReader } from '../readers/EpubReader.tsx'
import { useItem } from './data.ts'

export function ReadBook({ id, title, subtitle, onClose, onError }: { id: string; title: string; subtitle?: string; onClose: () => void; onError: (m: string) => void }) {
  const { item, error } = useItem(id)
  const external = item !== undefined && item.source?.type !== 'epub'

  useEffect(() => {
    if (error) { onError(error); onClose(); return }
    if (!external || item === undefined) return
    // 视频跳到接下来该看的那一集
    const next = item.source?.type === 'video' ? progressOf(item).current?.section.id : undefined
    void openSource(item.id, next).catch((e: Error) => onError(e.message)).finally(onClose)
  }, [external, error]) // eslint-disable-line react-hooks/exhaustive-deps

  if (item === undefined || external) return null
  return <EpubReader item={item} title={title} subtitle={subtitle} onClose={onClose} />
}
