// 构建：Host → lib/index.js（ESM），前端 → client/client.js（Harness 的 lazy-CJS 模块格式）
import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

// Harness 前端共享模块表（packages/client/web/src/platform.ts）：这些必须 external，用宿主的同一份
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]

/** 支持 `import x from 'file?raw'`：以文本形式内联。 */
const rawPlugin = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, async (args) => {
      const target = args.path.slice(0, -4)
      const result = await b.resolve(target, { resolveDir: args.resolveDir, kind: 'import-statement' })
      return { path: result.path, namespace: 'raw' }
    })
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }))
  },
}

const watch = process.argv.includes('--watch')

// ---- Host ----
await build({
  entryPoints: [resolve(root, 'src/host/index.ts')],
  outfile: resolve(root, 'lib/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*', 'pdfjs-dist', 'pdfjs-dist/*'],
  logLevel: 'warning',
})

// ---- Client ----
const client = await build({
  entryPoints: [resolve(root, 'src/client/index.tsx')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  plugins: [rawPlugin],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: !watch,
  legalComments: 'none',
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent' },
})
const code = client.outputFiles[0].text
// 与 dsh-client-modules 的 lazy-CJS 约定一致：注册工厂，首次使用时才执行
const wrapped = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
${code}
return module.exports;
} });
`
await writeFile(resolve(root, 'client/client.js'), wrapped).catch(async (error) => {
  if (error.code !== 'ENOENT') throw error
  const { mkdir } = await import('node:fs/promises')
  await mkdir(resolve(root, 'client'), { recursive: true })
  await writeFile(resolve(root, 'client/client.js'), wrapped)
})
console.log(`built lib/index.js + client/client.js (${(wrapped.length / 1024).toFixed(0)} KB)`)
