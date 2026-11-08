import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindChat, canChat, sendText, sendWithImages } from '../src/client/chat.ts'

test('会话服务通过 get 访问，选页检查和文字、附图发送不触发 Cordis 依赖错误', async () => {
  const sent = []
  const input = {
    setDraft: text => sent.push(['draft', text]),
    addAttachments: ids => { sent.push(['attachments', ids]); return true },
    submit: () => sent.push(['submit']),
  }
  const conversation = {
    send: async text => { sent.push(['send', text]) },
    createDrafts: (id, files, upload) => {
      assert.equal(id, 'session-1')
      assert.equal(files.length, 1)
      assert.equal(upload, true)
      return [{ id: 'image-1' }]
    },
    input: { for: ctx => { assert.equal(ctx, scoped); return input } },
  }
  const scoped = new Proxy({ get: name => name === 'conversation' ? conversation : undefined }, {
    get(target, key) {
      if (key === 'conversation') throw new Error('cannot get property "conversation" without inject')
      return Reflect.get(target, key)
    },
  })
  bindChat({ get: name => name === 'sessions' ? { scope: id => id === 'session-1' ? scoped : undefined } : undefined })
  assert.equal(canChat(undefined), false)
  assert.equal(canChat('missing'), false)
  assert.equal(canChat('session-1'), true)
  await sendText('session-1', '生成目录')
  assert.equal(sendWithImages('session-1', '读取图片', [new File(['test'], 'page.jpg')]), true)
  assert.deepEqual(sent, [['send', '生成目录'], ['draft', '读取图片'], ['attachments', ['image-1']], ['submit']])
  await assert.rejects(sendText('missing', 'test'), /找不到当前对话/)
  assert.equal(sendWithImages('missing', 'test', []), false)
})

test('会话未提供 conversation 时选页仍可渲染，附图能力缺失时返回 false', () => {
  bindChat({ get: () => ({ scope: () => ({ get: () => undefined }) }) })
  assert.equal(canChat('session-1'), false)
  assert.equal(sendWithImages('session-1', 'test', []), false)
  bindChat({ get: () => ({ scope: () => ({ get: () => ({ send: async () => {} }) }) }) })
  assert.equal(canChat('session-1'), true)
  assert.equal(sendWithImages('session-1', 'test', []), false)
})
