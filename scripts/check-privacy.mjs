// 个人信息检查：提交前（git hook）和 npm 发布前自动运行，发现问题就拦下。
//
// 用法：
//   node scripts/check-privacy.mjs            检查仓库里所有受 git 管理的文件
//   node scripts/check-privacy.mjs --staged   只检查本次要提交的内容（pre-commit 用）
//   node scripts/check-privacy.mjs --publish  检查 npm 包里的文件（prepublishOnly 用）
//
// 私人词表放在 privacy.local.txt（已被 .gitignore 忽略），一行一个词，# 开头是注释。
// 词表本身也是隐私，绝不能提交。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv.includes('--staged') ? 'staged' : process.argv.includes('--publish') ? 'publish' : 'all'
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

// ---- 规则 ----
const terms = existsSync(resolve(root, 'privacy.local.txt'))
  ? readFileSync(resolve(root, 'privacy.local.txt'), 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : []

/** 通用规则：不需要词表也能拦住的东西。allow 里的是允许出现的示例写法。 */
const RULES = [
  { name: '本机用户目录', re: /(?:\/Users\/|\/home\/|C:\\Users\\)([^/\\\s'"`)]+)/g, allow: m => ['你', 'me', 'you', 'user', 'USER', '<you>', 'runner', 'web_user'].includes(m[1]) },
  { name: '邮箱', re: /[\w.+-]+@(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|me|edu|dev|co|top|xyz|app)\b/g, allow: m => /noreply|example\.(com|org)|@deepseek-ai\/|@types\/|@anthropic-ai\/|@tanstack\//.test(m[0]) || /^@/.test(m[0]) },
  { name: '密钥', re: /\b(?:npm_[A-Za-z0-9]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g },
  { name: '手机号', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
]

const TEXT_EXT = new Set(['', '.md', '.txt', '.json', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.html', '.svg'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.heic', '.tif', '.tiff'])
// 这些文件本身就是规则定义或第三方锁文件，跳过
const SKIP = new Set(['scripts/check-privacy.mjs', 'pnpm-lock.yaml'])

// ---- 要检查的文件 ----
function listFiles() {
  if (mode === 'staged') return git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean)
  if (mode === 'publish') {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' })
    return JSON.parse(out)[0].files.map(f => f.path)
  }
  return git('ls-files').split('\n').filter(Boolean)
}

function readContent(file) {
  // staged 模式读暂存区里的版本，而不是工作区
  if (mode === 'staged') return execFileSync('git', ['show', `:${file}`], { cwd: root, maxBuffer: 64 << 20 })
  return readFileSync(resolve(root, file))
}

const problems = []
for (const file of listFiles()) {
  if (SKIP.has(file)) continue
  const ext = extname(file).toLowerCase()
  if (file.endsWith('.local.md') || file.endsWith('.local.txt')) {
    problems.push(`${file}: 本地私人文件不能提交或发布`)
    continue
  }
  let buf
  try { buf = readContent(file) } catch { continue }
  if (IMAGE_EXT.has(ext)) {
    // JPEG/HEIC 常带 EXIF（拍摄时间、设备，甚至 GPS 位置）
    if (buf.includes('Exif')) problems.push(`${file}: 图片带 EXIF 信息，可能包含位置/设备。请导出为 PNG 或去掉元数据`)
    continue
  }
  if (!TEXT_EXT.has(ext)) continue
  const lines = buf.toString('utf8').split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (rule.allow?.(m)) continue
        problems.push(`${file}:${i + 1}: ${rule.name}「${m[0]}」`)
      }
    }
    for (const t of terms) if (line.includes(t)) problems.push(`${file}:${i + 1}: 私人词表命中「${t}」`)
  })
}

// 提交者邮箱会公开在 git 历史里
if (mode !== 'publish') {
  const email = git('config', 'user.email').trim()
  if (!/noreply/.test(email)) problems.push(`git 提交邮箱是 ${email}，公开后谁都能看到。请改用 GitHub 隐私邮箱`)
}

if (problems.length) {
  console.error(`\n✋ 个人信息检查没通过（${problems.length} 处）：\n`)
  for (const p of problems) console.error('  - ' + p)
  console.error('\n改掉后再提交 / 发布。确实是误报的话，调整 scripts/check-privacy.mjs 里的 allow 规则。\n')
  process.exit(1)
}
console.log(`✓ 个人信息检查通过（${mode}${terms.length ? `，私人词表 ${terms.length} 个词` : '，⚠ 没有 privacy.local.txt'}）`)
