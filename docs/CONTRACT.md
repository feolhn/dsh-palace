# 契约：数据结构与模块接口（v0.2）

> v0.2 实现中（存储、宫殿、笔记本已完成）。类型定义最终以 `src/shared/` 为准，这里是设计说明；改契约要先改这里，再改代码。
> v0.1 的 `library.json` 不迁移（见决策存档 #83），v0.2 起用下面的新格式。

## 1. 数据目录

默认 `~/Documents/dsh-palace-data/`，可以在 profile 的 `cordis.patch.yml` 里用 `config.dataDir` 改。

```
dsh-palace-data/
├─ palace.json        宫殿布局（原始数据）
├─ items/<id>.json    每个书 / 笔记格子的内容（原始数据），文件名就是格子 id
├─ images/            卡片原图
├─ links.jsonl        电弧的「联想」记录（原始数据，只追加，见 §8）
├─ memory/            AI 维护的记忆：me.md、cells/<id>.md（见 §8）。删掉不丢用户的卡片和灵感，只丢 AI 的总结
└─ library.json       v0.1 遗留，v0.2 不读不写
```

通用规则：
- 所有写入都是原子的（先写临时文件再改名），同一进程内串行。
- 用户可能手动改文件：读之前看修改时间和大小，变了就重新读；解析失败就继续用内存里的版本，并拒绝写入，不覆盖用户的文件。
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
    { "id": "c_…", "kind": "book",  "parentId": "c_…", "col": 0, "row": 0, "title": "刑法讲义", "subtitle": "张明楷", "createdAt": "ISO" },
    { "id": "c_…", "kind": "note",  "parentId": null, "col": -1, "row": 2, "title": "十一月的心情", "createdAt": "ISO" }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `kind` | `book`：有原文（PDF、EPUB、视频课……）；`note`：没有原文；`group`：分组 |
| `parentId` | `null` 表示在宫殿最外层；否则是所在分组的 id |
| `col`, `row` | 整数坐标。最外层可以是负数；分组里从 0 开始 |
| `title`, `subtitle` | 格子上显示的文字。subtitle 是「备注」，可选：标题上方一行小字，用户想填什么都行（作者、另一种语言的书名……） |
| `icon` | 可选：水彩图标名（`vendor/icons/<icon>.webp`，经 `asset?f=icons/<icon>.webp` 读取）。不填时前端按 id 固定挑一个，分组默认彩虹 |

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
  "outlineSource": "bookmarks",              // bookmarks（PDF 书签）| toc（EPUB 自带目录）| ai | video | manual
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
  "image": "k_….png",         // 原图，相对 images/，可选。一张图只属于一张卡片，删卡片时一起删
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

阅读器模块只管渲染和事件，存位置、记卡片由外层界面负责。第一个实现是 EPUB（`src/client/readers/epub.ts`）：

```ts
function mountEpub(el: HTMLElement, opts: {
  data: ArrayBuffer               // 原文字节，来自 GET file?id=
  initialLoc?: string             // item.position.loc（CFI）
  highlights: string[]            // 已有摘录卡片的 loc（CFI），在书里显示高亮
  fontSize: number
  onPosition(loc: string, percent: number, href: string): void  // 翻页后回报；外层停 1 秒再 setPosition
  onSelect(sel: { quote: string; loc: string }): void            // 用户选中一段 → 外层问要不要记成摘录
  onToc(outline: OutlineInput[]): void                          // 书自带的目录；item 还没有目录时外层 setOutline(source: 'toc')
}): Promise<{ prev(); next(); goTo(loc); highlight(cfi); clearSelection(); setFontSize(px); destroy() }>
```

- 书里的脚本一律不执行（`allowScriptedContent: false`）。
- 摘录卡片的 `loc` 是选区 CFI，`sectionId` 是当前所在文件对应的节。
- PDF 仍用系统程序打开；video 不在插件里播放，只负责「打开链接」。

### 4.3 memory（host 端）

`src/core/memory.ts` 的 `Memory`：读写记忆页、联想和电弧，拼对话背景。不调模型，内容都由对话里的 AI 用工具写。详见 §8。

### 4.4 share（前端）

`card.share` 的结构由 share 模块自己定义并做版本兼容，core 只校验它是对象、不超过 64 KB，然后原样保存。导出的 PNG 在浏览器里生成，不经过 host。

当前草稿（`src/client/share/model.ts`，`v: 1`）：

```jsonc
{
  "v": 1,
  "color": "#efe8d2",            // 纸色
  "font": "song",                // song / kai / fang / hei（系统字体，字体包以后加）
  "size": 50, "noteSize": 36,    // 原文 / 想法字号，纸张像素
  "align": "center",             // left / center
  "showQuote": true, "showNote": true, "showSource": true,
  "source": "— 《书名》 · 作者",  // 用户改写过才有，否则按标题和备注生成
  "ranges": { "quote": [[0, 12]], "note": [] },   // 选段，UTF-16 偏移 [start, end)
  "basis": { "quote": "长度:哈希", "note": "…" }  // 选段时原文的指纹，原文改了选段就作废、重新全选
}
```

纸张固定 1080×1440。认不出的字段保存时原样保留。

## 5. HTTP 接口（前端 ↔ host）

都挂在 Harness 的 `/api` 通道上（由 Harness 负责鉴权），前缀 `/api/dsh-palace/`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `palace` | `{ rev, palace, summaries, dataDir }`。summaries 是每个格子的进度摘要（`{done,total,perDay?,cards,finished,source?,period?,percent?}`，percent 给格子上的月亮用），画布不用读全部 item |
| GET | `item?id=` | `{ rev, item }` |
| GET | `rev` | `{ rev }`，前端轮询，变了就重新拉取 |
| POST | `op` | `{ op, args }` → `{ rev, result }`，op 白名单见 `src/host/routes.ts` |
| GET | `file?id=` | 原文字节（pdf、epub），只给登记过的路径 |
| GET | `image?name=` | 卡片原图 |
| GET | `page-text?id=&pages=1,2` | `{ pages: [{page,text}], scanned: [页码] }`，PDF 选目录页用 |
| GET | `asset?f=` | 前端需要的静态资源：`reader/epub.min.js`、`reader/jszip.min.js`（白名单），pdf.js 的 CMap 等 |
| POST | `pick-file` | macOS 弹出文件选择框 |
| POST | `open` | 用系统程序打开原文或数据目录 |
| POST | `active` | `{ sessionId, itemId \| null }`：某个对话当前打开的格子 |
| GET | `arcs` | `{ rev, arcs }`：电弧，`[{ from, to, strands, why, lastAt, links }]`，按股数排序（见 §8） |
| POST | `cut-arc` | `{ from, to }`：用户剪断两格之间的电弧 |
| GET | `lookup?word=` | `{ supported, definition, lemma? }`：查词（#43），用 macOS 自带词典（Dictionary Services，经 osascript JXA，单词作参数传入）；`lemma` 是变形词的原形和释义；非 macOS `supported: false` |
| POST | `open-dictionary` | `{ word }`：在系统「词典」App 里打开完整词条 |
| GET | `chat-workspace` | `{ cwd }`：数据目录的绝对路径，前端把它登记成工作区「Memory Palace」，宫殿里的 AI 对话建在这里（见 §7） |

业务错误返回 HTTP 400 和 `{ ok: false, error: "中文说明" }`。

## 6. AI 工具

| 工具 | 作用 |
|---|---|
| `palace_overview` | 列出宫殿里的格子和进度；传 `item_id` 时返回完整目录和卡片 |
| `palace_add` | 新建分组、书（pdf / epub / 视频）、笔记格子 |
| `palace_read` | 读 PDF 指定页的文字，并说明哪些读不出（扫描页） |
| `palace_set_outline` | 写入两级目录 |
| `palace_set_target_dates` | 批量设置目标日期 |
| `palace_add_card` | 记一张卡片（摘录 / 想法 / 错题）。格子默认取当前对话打开的那个，节默认取当前节；`image` 填图片路径或 `sha256:` 附件 id |
| `palace_add_inspiration` | 把这次对话总结成一条灵感，存到当前格子 |
| `palace_remove` | 删除格子（书 / 笔记 / 空分组），连同卡片和灵感，不删原文件；调用前必须得到用户明确同意 |
| `palace_wiki_read` | 读一页记忆：格子 id 或 `me` |
| `palace_wiki_write` | 整页重写一页记忆（正文 ≤500 字，超了拒绝）；格子页带一句话 `summary` 和 3–5 个 `topics` |
| `palace_link` | 在两格之间连一条联想：`why` 一句话 + 两端各至少一条证据（卡片 / 灵感 id） |
| `palace_unlink` | 剪断两格之间的电弧 |

## 7. 宫殿里的 AI 对话

全屏宫殿右侧的「与宫殿对话」、打开书 / 笔记后的「与书对话」，嵌入的是 Harness **原生对话界面**，背后是真实的 Harness 会话（用户配好的模型、上面的工具、左侧会话列表里能接着聊）。

- 做法照 Harness 自带的 subagent 侧栏：`main` slot 声明 session 作用域的子 slot `dsh-palace.chat` → 面板拿到 `SessionProvider` / `renderSlot` → `sessions.retain(id)` 包住子 slot → 子 slot 渲染 `conversation.content`（`variant: 'embedded'`，不显示首页大标题）。代码在 `src/client/chat/`。
- 会话：宫殿一个、每个书 / 笔记格子各一个，映射记在本机 localStorage（`dsh-palace:chat-sessions`）；会话被删或归档后自动新建；「新对话」换一个新的，旧的留在会话列表里。新建时用 `workspaces.create({ path: 数据目录 })` 登记工作区再 `sessions.create({ workspaceId })`，不切换主界面。
- 打开对话时上报 `active`，AI 记卡片、存灵感默认记到这本书。
- 都是 Harness 的非公开接口：拿不到时面板显示提示，宫殿其他功能不受影响。同一个会话不要同时在两处挂输入框（每个会话只有一个编辑器）。

## 8. 记忆与电弧（#8）

原则：不用向量检索、不跑后台任务，只靠对话里的 AI 调工具；内容越多、模型越强，效果越好。以后的玩法见 Discussion #47。

**记忆页**（`memory/`，Markdown，frontmatter 里有 `summary`、`topics`、`writtenAt`）：
- `me.md`：关于用户的长期记忆，「长期」「最近」两段，只记用户说过或做过的事实。
- `cells/<id>.md`：每格一页 wiki，只写卡片和灵感里没有的（意味着什么、卡在哪、反复的主题、未解的疑问），句末 `[^卡片或灵感 id]` 标依据。
- 正文上限 500 字：超了工具直接拒绝，让 AI 当场合并、精简后整页重写。不做自动压缩（原始的卡片和灵感都在）。
- 欠账：页面 `writtenAt` 之后新增的卡片 / 灵感数。记卡片、存灵感时欠账 ≥3 就在工具结果里提示 AI 顺手更新（每个对话每格只提示一次）。

**联想与电弧**（`links.jsonl`，一行一条，只追加）：
```jsonc
{ "type": "link", "id": "l_…", "from": "c_…", "to": "c_…", "why": "≤40 字", "evidence": ["k_…", "i_…"], "sessionId": "…", "createdAt": "ISO" }
{ "type": "cut", "from": "c_…", "to": "c_…", "createdAt": "ISO" }
```
- 存「联想」不存「弧」。电弧由有效联想按格子对聚合：股数 = 有效联想条数，`why` 取最新一条。
- 有效：两端格子都在、晚于这对格子最近一次剪断、两端各还剩至少一条证据（证据卡片删了就失效）。
- 同一对格子，每条新联想至少要带一条这对格子还没用过的证据（旧证据换组合不算）；有新证据再连一条，电弧变粗。剪断后 AI 不能自己重连，用户明确要求（`user_asked`）才行。
- 手改坏的行跳过。

**对话背景**：宫殿的对话（会话建在数据目录下，或前端上报了打开的格子）每次请求附上一段背景（`systemPrompt.context`，约 6000 字以内）：使用说明、`me.md`、宫殿索引（每格一行：标题 · 一句话 · 主题词 · 最近活跃月份；当前格、它的电弧邻居和最近活跃的 30 格写整行，其余只列标题）、当前格的 wiki 和电弧。用户别的对话不附。

