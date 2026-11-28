// 演示站构建：demo/src → demo/dist（Cloudflare Pages 发布这个目录）。先在 demo/ 里 npm ci，再 node demo/build.mjs [--serve]
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, 'dist')
const vendor = resolve(here, '../vendor')

/** 和插件构建一样支持 `import x from 'file?raw'` */
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, async (a) => {
      const r = await b.resolve(a.path.slice(0, -4), { resolveDir: a.resolveDir, kind: 'import-statement' })
      return { path: r.path, namespace: 'raw' }
    })
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async a => ({ contents: await readFile(a.path, 'utf8'), loader: 'text' }))
  },
}

/** 演示站不读 PDF：宫殿组件间接引入的 pdf.js 换成空壳，不用装这个大依赖 */
const noPdf = {
  name: 'no-pdf',
  setup(b) {
    b.onResolve({ filter: /^pdfjs-dist/ }, a => ({ path: a.path, namespace: 'no-pdf' }))
    b.onLoad({ filter: /.*/, namespace: 'no-pdf' }, () => ({
      contents: "export default ''; export class PDFWorker {}; export function getDocument() { throw new Error('演示站不读 PDF') }",
      loader: 'js',
    }))
  },
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
await build({
  entryPoints: [resolve(here, 'src/main.tsx')],
  outfile: resolve(out, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  plugins: [noPdf, raw],
  // 插件源码（../src/client）里的 react 从演示站自己的依赖里找
  nodePaths: [resolve(here, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent' },
})
cpSync(resolve(here, 'index.html'), resolve(out, 'index.html'))
cpSync(resolve(here, 'demo.css'), resolve(out, 'demo.css'))
// 皮肤和字体：apiUrl('asset', { f }) 在演示站里指向 assets/<f>
cpSync(resolve(vendor, 'themes'), resolve(out, 'assets/themes'), { recursive: true })
cpSync(resolve(vendor, 'fonts'), resolve(out, 'assets/fonts'), { recursive: true })
// 阅读器脚本（epub.js、jszip）和它们的许可证
for (const f of ['epub.min.js', 'jszip.min.js', 'epub.LICENSE.txt', 'jszip.LICENSE.md']) cpSync(resolve(vendor, f), resolve(out, 'assets/reader', f))
// 演示数据：用插件的 Core 读 demo/data/，算成一个 JSON（demo/snapshot.ts）。先打包成一个 Node 脚本再运行，不挑 Node 版本
const snap = resolve(out, '.snapshot.mjs')
await build({ entryPoints: [resolve(here, 'snapshot.ts')], outfile: snap, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'warning' })
const { snapshot } = await import(pathToFileURL(snap).href)
rmSync(snap)
const data = resolve(here, 'data')
mkdirSync(resolve(out, 'assets/demo'), { recursive: true })
const snapped = snapshot(data)
writeFileSync(resolve(out, 'assets/demo/data.json'), JSON.stringify(snapped))
// 原文和卡片原图：只复制数据里引用到的（目录里多放的文件不会被发布出去）。原文只放能公开的：公版书、自己写的东西
const used = { files: new Set(), images: new Set() }
for (const item of Object.values(snapped.items)) {
  if (item.source !== null && item.source.type !== 'video') used.files.add(basename(item.source.path))
  for (const card of item.cards) if (card.image) used.images.add(basename(card.image))
}
for (const [d, names] of Object.entries(used)) for (const name of names) {
  const from = resolve(data, d, name)
  if (existsSync(from)) cpSync(from, resolve(out, 'assets/demo', d, name))
}
console.log('built demo/dist')

if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http')
  const { createReadStream, existsSync, statSync } = await import('node:fs')
  const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2', ttf: 'font/ttf', json: 'application/json', epub: 'application/epub+zip', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }
  const port = Number(process.env.PORT ?? 4195)
  createServer((req, res) => {
    let file = resolve(out, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(out)) { res.writeHead(403).end(); return }
    if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, 'index.html')
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return }
    res.writeHead(200, { 'content-type': types[file.split('.').pop()] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`))
}
