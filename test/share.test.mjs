// 分享卡片排版模型测试：node --test test/share.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultSource, draftFor, fingerprint, layout, mergeDraft, normalizeRanges, selectedText, wrap } from '../src/client/share/model.ts'

/** 假的量宽：每个字符宽 = 字号。 */
const measure = (t, size) => [...t].length * size

test('选段：裁剪、排序、合并重叠', () => {
  assert.deepEqual(normalizeRanges([[5, 8], [0, 3], [2, 4], [9, 99], [7, 7], 'x'], 10), [[0, 4], [5, 8], [9, 10]])
  assert.equal(selectedText('一二三四五六', [[4, 6], [0, 2]]), '一二\n…\n五六')
})

test('草稿：默认值、坏字段回退、原文改了选段作废', () => {
  const texts = { quote: '原文一段', note: '' }
  const d = draftFor({ color: 'red', font: 'nope', size: 999, align: 'left' }, texts)
  assert.equal(d.color, '#efe8d2')
  assert.equal(d.font, 'song')
  assert.equal(d.size, 76)
  assert.equal(d.align, 'left')
  assert.deepEqual(d.ranges.quote, [[0, 4]])
  assert.deepEqual(d.ranges.note, [])

  const kept = draftFor({ ranges: { quote: [[1, 2]] }, basis: { quote: fingerprint('原文一段') } }, texts)
  assert.deepEqual(kept.ranges.quote, [[1, 2]])
  const reset = draftFor({ ranges: { quote: [[1, 2]] }, basis: { quote: fingerprint('改过的原文') } }, texts)
  assert.deepEqual(reset.ranges.quote, [[0, 4]])
})

test('保存：保留认不出的字段，恢复默认出处时删掉 source', () => {
  const saved = { future: 1, source: '旧出处' }
  const d = draftFor(saved, { quote: 'a', note: '' })
  assert.equal(d.source, '旧出处')
  const out = mergeDraft(saved, { ...d, source: undefined })
  assert.equal(out.future, 1)
  assert.equal('source' in out, false)
})

test('断行：句末标点不放行首，英文单词不拆', () => {
  // 每行最多 4 个字
  assert.deepEqual(wrap('一二三四。五', 4, t => [...t].length), ['一二三', '四。五'])
  assert.deepEqual(wrap('ab hello', 4, t => [...t].length), ['ab', 'hell', 'o'])
  assert.deepEqual(wrap('ab cd', 5, t => [...t].length), ['ab cd'])
})

test('排版：居中、出处、放不下时报 overflow', () => {
  const d = draftFor(undefined, { quote: '短句', note: '想法' })
  const r = layout(d, { quote: '短句', note: '想法' }, defaultSource('创造自然', '安德烈娅·武尔夫'), measure)
  assert.equal(r.blocks.length, 2)
  assert.equal(r.overflow, false)
  assert.deepEqual(r.source, ['— 《创造自然》 · 安德烈娅·武尔夫'])
  assert.ok(r.blocks[0].top > 150)

  const long = '字'.repeat(2000)
  const big = layout(draftFor(undefined, { quote: long, note: '' }), { quote: long, note: '' }, '', measure)
  assert.equal(big.overflow, true)

  const none = layout({ ...d, showQuote: false, showNote: false }, { quote: '短句', note: '想法' }, '', measure)
  assert.equal(none.empty, true)
})
