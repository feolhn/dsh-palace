// 查词（#43）：node --import ./test/stubs/register.mjs --test test/lookup.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatEntry, wordAt } from '../src/client/readers/lookup.ts'

test('点中的单词', () => {
  assert.equal(wordAt("He didn't go", 6).text, "didn't")
  assert.equal(wordAt('a well-being b', 5).text, 'well-being')
  assert.equal(wordAt('你好 hello', 1), undefined)
})

test('系统词典文字排版：音标、义项、例句，去掉拼音', () => {
  const e = formatEntry('serendipity | BrE ˌsɛr(ə)nˈdɪpɪti, AmE ˌsɛrənˈdɪpədi | noun formal ① uncountable (luck) 机缘凑巧 jīyuán còuqiǎo ② countable (unplanned event) 巧事 qiǎo shì ▸ a happy serendipity 幸运的巧合 xìngyùn de qiǎohé')
  assert.equal(e.head, 'serendipity')
  assert.match(e.phonetic, /^BrE/)
  assert.equal(e.senses.length, 3)
  assert.equal(e.senses[1].text, '① uncountable (luck) 机缘凑巧')
  assert.equal(e.senses[2].text, '② countable (unplanned event) 巧事')
  assert.equal(e.senses[2].examples[0], 'a happy serendipity 幸运的巧合')
  assert.deepEqual(formatEntry('奇怪的格式').senses, [{ text: '奇怪的格式', examples: [] }])
})
