// 用法：node --experimental-strip-types test/pdf-smoke.mjs <pdf>
import { readPdfInfo, readPageTexts } from '../src/host/pdf.ts'
const file = process.argv[2]
const t0 = Date.now()
const info = await readPdfInfo(file)
console.log('pages', info.pageCount, 'title', info.title, 'outline chapters', info.outline.length, `${Date.now() - t0}ms`)
console.log(JSON.stringify(info.outline.slice(0, 3), null, 1).slice(0, 800))
const texts = await readPageTexts(file, [1, 2, 3, 4, 5, 6])
for (const t of texts) console.log('--- page', t.page, t.text.length, JSON.stringify(t.text.slice(0, 120)))
