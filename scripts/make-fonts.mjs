// 字体包（#10 / #44）：界面用的两款开源字体（SIL OFL 1.1），随插件发布、默认加载。
//   思源宋体：用 Fontsource 的 Noto Serif SC（同一套字形，Google 发布名），按 unicode-range 切成约 100 片，浏览器只下载用到的片
//   EB Garamond：只取 latin / latin-ext
// 生成 vendor/fonts/*.woff2、fonts.css、OFL.txt。运行：node scripts/make-fonts.mjs（需要联网，用 npm pack 下载）
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'vendor/fonts')

// [npm 包, 取哪个 css, 只保留哪些 @font-face（按注释名过滤）, 插件里的字体名]
const SOURCES = [
  ['@fontsource/noto-serif-sc@5', '400.css', () => true, 'Palace Source Han Serif'],
  ['@fontsource/eb-garamond@5', '400.css', name => /-latin(-ext)?-400-normal$/.test(name), 'Palace EB Garamond'],
]

const tmp = await mkdtemp(join(tmpdir(), 'shelf-fonts-'))
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
const css = []
const licenses = []
for (const [spec, file, keep, family] of SOURCES) {
  const tgz = execFileSync('npm', ['pack', spec, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop()
  const dir = join(tmp, tgz.replace(/\.tgz$/, ''))
  await mkdir(dir)
  execFileSync('tar', ['xzf', join(tmp, tgz), '-C', dir])
  const pkg = join(dir, 'package')
  const source = await readFile(join(pkg, file), 'utf8')
  for (const block of source.split(/(?=\/\* )/)) {
    const name = /^\/\* (\S+) \*\//.exec(block)?.[1]
    if (name === undefined || !keep(name)) continue
    const woff2 = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1]
    const range = /unicode-range: ([^;]+);/.exec(block)?.[1]
    if (woff2 === undefined) continue
    await copyFile(join(pkg, 'files', woff2), join(out, woff2))
    css.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:swap;src:url(fonts/${woff2}) format('woff2');${range ? `unicode-range:${range};` : ''}}`)
  }
  const license = (await readdir(pkg)).find(f => /^LICEN[CS]E/i.test(f))
  if (license) licenses.push(`==== ${family}（${spec}）====\n\n${await readFile(join(pkg, license), 'utf8')}`)
}
await writeFile(join(out, 'fonts.css'), css.join('\n') + '\n')
await writeFile(join(out, 'OFL.txt'), licenses.join('\n\n'))
await rm(tmp, { recursive: true, force: true })
console.log(`vendor/fonts：${css.length} 个 @font-face`)
