# 契约：数据结构与模块接口（v0.2）

> v0.2 实现中。类型定义最终以 `src/shared/` 为准，这里是设计说明；改契约要先改这里，再改代码。
> v0.1 的 `library.json` 不迁移（见 WORK §4），v0.2 起用下面的新格式。

## 1. 数据目录

默认 `~/Documents/dsh-shelf-data/`，可以在 profile 的 `cordis.patch.yml` 里用 `config.dataDir` 改。

```
dsh-shelf-data/
├─ palace.json        宫殿布局（原始数据）
├─ items/<id>.json    每个书 / 笔记格子的内容（原始数据），文件名就是格子 id
├─ images/            卡片原图
├─ memory/            记忆（派生数据，由 memory 模块管理，可以删掉重建）
└─ library.json       v0.1 遗留，v0.2 不读不写
```

通用规则：
- 所有写入都是原子的（先写临时文件再改名），同一进程内串行。
- 用户可能手动改文件：读之前看修改时间，变了就重新读；解析失败就继续用内存里的版本，不覆盖用户的文件。
- **认不出的字段原样保留**，不能在读写一遍后丢掉。
- 时间：`createdAt` 等用 ISO 时间戳；日期用本地 `YYYY-MM-DD`。
- id：`<前缀>_<10 位十六进制>`，前缀见下文。

**跨文件的修改**（新建 / 删除格子同时动 `palace.json`、`items/<id>.json` 和图片）没有事务，靠固定顺序保证「最坏情况也不坏」：
1. 先写所有要新建或修改的 `items/<id>.json`；
2. 再写 `palace.json`；
3. 最后删除要删的 item 文件和图片。

任何一步失败或进程退出，可能出现的只有两种情况，都按下面处理：
- **有 item 文件、但 palace 里没有这个格子**（第 2 步前失败）：孤儿文件，忽略；以后可以清理。
- **palace 里有书 / 笔记格子、但没有 item 文件**（用户手删，或旧版本数据）：当作空内容读出（没有原文、目录、卡片），下次修改时再写出文件。不报错。
- 图片没删掉只会多占空间，不影响数据。

## 2. palace.json

```jsonc
{
  "schema": 2,
  "cells": [
    { "id": "c_…", "kind": "group", "parentId": null, "col": 0, "row": 0, "title": "2027 法考", "createdAt": "ISO" },
    { "id": "c_…", "kind": "book",  "parentId": "c_…", "col": 0, "row": 0, "title": "刑法讲义", "subtitle": "作者", "createdAt": "ISO" },
    { "id": "c_…", "kind": "note",  "parentId": null, "col": -1, "row": 2, "title": "十一月的心情", "createdAt": "ISO" }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `kind` | `book`：有原文（PDF、EPUB、视频课……）；`note`：没有原文；`group`：分组 |
| `parentId` | `null` 表示在宫殿最外层；否则是所在分组的 id |
| `col`, `row` | 整数坐标。最外层可以是负数；分组里从 0 开始 |
| `title`, `subtitle` | 格子上显示的文字。subtitle 可选（作者、副标题） |

规则：
- 同一层里 `(parentId, col, row)` 不能重复。移动到有格子的位置 = 两个格子互换，一次写入完成。
- `parentId` 必须指向一个 `group`。**v0.2 分组只能在最外层**，不能套娃。
- 非空的分组不能删除，要先把里面的格子移出去或删掉。
- 删除 book / note 格子会同时删掉 `items/<id>.json` 和它的卡片原图；不会删除 PDF 等原文件。

## 3. items/&lt;id&gt;.json

book 和 note 格子各有一个；group 没有。

```jsonc
{
  "schema": 2,
  "id": "c_…",
  "source": { "type": "pdf", "path": "/abs/a.pdf", "pageCount": 254 },  // note 格子为 null
  "targetDate": "2026-12-31",
  "finishedAt": "2026-12-20",                // 用户手动标记读完的日期，可选
  "outlineSource": "bookmarks",              // bookmarks | ai | video | manual
  "chapters": [{ "id": "ch_…", "title": "第一讲", "sections": [
    { "id": "s_…", "title": "刑法的解释", "loc": "12", "done": true, "doneAt": "ISO" }
  ]}],
  "position": { "loc": "…", "percent": 0.42 },   // 阅读器记住的上次位置，可选
  "cards": [ /* Card */ ],
  "inspirations": [ /* Inspiration */ ]
}
```

### source（原文）

| `type` | 字段 | 说明 |
|---|---|---|
| `pdf` | `path`, `pageCount` | 只引用路径，不复制 |
| `epub` | `path` | 只引用路径，不复制 |
| `video` | `url` | B 站等视频课 |

`loc`（位置）是一个字符串，**只有对应的 source 和 reader 认识它**，core 不解析：
- pdf：页码，如 `"12"`
- epub：CFI 或章节 href
- video：这一集的链接

### 进度
- 每章至少一节（没有分节的章自动生成同名节），进度按节计数。
- 重新生成目录时，章、节标题都相同的节保留完成状态；被删掉的节上挂的卡片 `sectionId` 清空。
- `percent` 是 0–1 的小数，只是阅读器的位置，和「读完」无关。

### Card（卡片），id 前缀 `k_`

```jsonc
{
  "id": "k_…",
  "type": "excerpt",          // excerpt 摘录 | thought 想法 | mistake 错题
  "sectionId": "s_…",         // 挂在哪一节，可选
  "loc": "…",                 // 原文位置（摘录时阅读器给的），可选
  "quote": "原文 / 题目",       // thought 没有
  "note": "我的想法 / 批注 / 错因",
  "answer": "正确答案",         // 只有 mistake
  "status": "todo",           // 只有 mistake：todo 待重做 | mastered 已掌握
  "image": "k_….png",         // 原图，相对 images/，可选
  "createdAt": "ISO",
  "share": { }                // 分享卡片的排版草稿，由 share 模块定义，core 原样保存
}
```

### Inspiration（灵感），id 前缀 `i_`

```jsonc
{
  "id": "i_…",
  "title": "洪堡为什么要同时做三件事",
  "body": "Markdown 正文：AI 对这次对话的总结",
  "sessionId": "…",           // 来自哪个 Harness 对话，可选
  "cardIds": ["k_…"],         // 关联的卡片，可选
  "createdAt": "ISO"
}
```

## 4. 模块接口

### 4.1 source（host 端，每种原文一个）

```ts
interface Source {
  type: 'pdf' | 'epub' | 'video'
  /** 校验并补全用户给的原文信息（如读 PDF 页数）。 */
  inspect(input: unknown, opts?: { signal?: AbortSignal }): Promise<SourceRef>
  /** 读目录。没有（如扫描版 PDF 没书签）返回 null，交给 AI 生成。 */
  outline(src: SourceRef, opts?: { signal?: AbortSignal }): Promise<OutlineInput[] | null>
  /** 给 AI 读原文。locs 由各 source 自己解释；扫描页等读不出文字的单独列出。 */
  readText?(src: SourceRef, locs: string[], opts?: { signal?: AbortSignal }): Promise<{ texts: { loc: string; text: string }[]; unreadable: string[] }>
}
```

**取消**：三个方法都接收调用方的 `signal`（来自 AI 工具或 HTTP 请求）。实现必须把它继续传给网络请求（`fetch`）、PDF 解析等内部任务；收到取消后尽快以 `AbortError` 结束，不写入任何数据。Harness 取消工具时只会等工具自己结束，不会强制中断，所以不传 signal 的实现会在用户点「停止」后继续跑完。

### 4.2 reader（前端，每种原文一个，用到时才加载）

```ts
interface ReaderModule {
  type: 'pdf' | 'epub' | 'video'
  /** 把阅读器挂到 el 上，返回卸载函数。 */
  mount(el: HTMLElement, opts: {
    item: Item
    initialLoc?: string
    onPosition(loc: string, percent: number): void            // 翻页时回报位置（节流后保存）
    onExcerpt(excerpt: { quote: string; loc: string }): void  // 用户划线 → 生成摘录卡片
  }): () => void
}
```

video 不在插件里播放，reader 只负责「打开链接」。

### 4.3 memory（host 端）

```ts
interface Memory {
  /** 新对话开始时附带的背景，控制在 maxChars 以内。itemId 是当前打开的格子。 */
  context(opts: { itemId?: string; maxChars: number }): Promise<string>
  /** 给 AI 的工具（搜索、读、写记忆）。会和 core 的工具一起注册。 */
  tools(): Tool[]
  /** 原始数据变了。实现可以忽略，也可以记下来等 AI 整理。 */
  onChange?(change: { kind: 'item' | 'card' | 'inspiration'; itemId: string; id?: string; op: 'add' | 'update' | 'delete' }): void
}
```

v0.2 的第一个实现（`memory/wiki`）：Karpathy 式 Markdown wiki，`memory/index.md` 是目录，AI 通过工具读写页面；`context()` 返回 `index.md` 的开头部分。整理工作由 AI 在对话中完成，host 代码不调用模型。

### 4.4 share（前端）

`card.share` 的结构由 share 模块自己定义并做版本兼容，core 只负责原样保存。导出的 PNG 在浏览器里生成，不经过 host。

## 5. HTTP 接口（前端 ↔ host）

都挂在 Harness 的 `/api` 通道上（由 Harness 负责鉴权），前缀 `/api/dsh-shelf/`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `palace` | `{ rev, palace, summaries, dataDir }`。summaries 是每个格子的进度摘要（`{done,total,perDay?}`），画布不用读全部 item |
| GET | `item?id=` | `{ rev, item }` |
| GET | `rev` | `{ rev }`，前端轮询，变了就重新拉取 |
| POST | `op` | `{ op, args }` → `{ rev, result }`，op 白名单见 `src/host/routes.ts` |
| GET | `file?id=` | 原文字节（pdf、epub），只给登记过的路径 |
| GET | `image?name=` | 卡片原图 |
| GET | `asset?f=` | 前端需要的静态资源（pdf.js 的 CMap、阅读器脚本等） |
| POST | `pick-file` | macOS 弹出文件选择框 |
| POST | `open` | 用系统程序打开原文或数据目录 |
| POST | `active` | `{ sessionId, itemId \| null }`：某个对话当前打开的格子 |

业务错误返回 HTTP 400 和 `{ ok: false, error: "中文说明" }`。

## 6. AI 工具

| 工具 | 作用 |
|---|---|
| `shelf_overview` | 列出宫殿里的格子和进度；传 `item_id` 时返回完整目录和卡片 |
| `shelf_add` | 新建分组、书（pdf / epub / 视频）、笔记格子 |
| `shelf_read` | 读原文指定位置的文字，并说明哪些读不出（扫描页） |
| `shelf_set_outline` | 写入两级目录 |
| `shelf_set_target_dates` | 批量设置目标日期 |
| `shelf_add_card` | 记一张卡片（摘录 / 想法 / 错题）。格子默认取当前对话打开的那个，节默认取当前节；`image` 填图片路径或 `sha256:` 附件 id |
| `shelf_add_inspiration` | 把这次对话总结成一条灵感，存到当前格子 |
| `memory_*` | 由 memory 模块提供 |
