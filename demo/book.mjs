// 演示站的示意书页（#107）：构建时打成一个很小的 EPUB，放在 dist/assets/demo-book.epub。
// 文字是自己写的占位，不摘任何书的原文；台本定下来后改这里。
import { deflateRawSync } from 'node:zlib'

export const BOOK = {
  title: '宇宙（示意书页）',
  chapters: [
    {
      title: '第一章　山顶上',
      paragraphs: [
        '（演示用的示意文字，不是原书内容。）',
        '爬到山顶的时候，云从脚下流过去。山这一面长着苔藓，另一面是矮松，再往下是草甸。',
        '同一座山，高度每换一截，植物就换一批。像是把从赤道到极地的路，竖着叠在了一座山上。',
        '这让人想到：看起来不相干的东西，常常被同一条看不见的线串着。',
        '记下它的人，未必知道这条线通向哪里。可只要记下来，总有一天会和别的念头碰上。',
      ],
    },
  ],
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function files() {
  const ch = BOOK.chapters.map((c, i) => [`OEBPS/ch${i + 1}.xhtml`,
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh"><head><title>${esc(c.title)}</title></head><body><h2>${esc(c.title)}</h2>${c.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</body></html>`])
  const nav = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${BOOK.chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`
  const opf = `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">dsh-palace-demo-book</dc:identifier><dc:title>${esc(BOOK.title)}</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-11-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${BOOK.chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${BOOK.chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('')}</spine></package>`
  return [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OEBPS/content.opf', opf],
    ['OEBPS/nav.xhtml', nav],
    ...ch,
  ]
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** 最小的 zip：mimetype 不压缩且排第一（EPUB 规定），其余 deflate */
export function epub() {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of files()) {
    const data = Buffer.from(text, 'utf8'), store = name === 'mimetype'
    const body = store ? data : deflateRawSync(data), nameBuf = Buffer.from(name)
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(store ? 0 : 8, 8)
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26)
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(store ? 0 : 8, 10)
    cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42)
    locals.push(head, nameBuf, body); centrals.push(cen, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cenSize = centrals.reduce((t, b) => t + b.length, 0), n = centrals.length / 2
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
