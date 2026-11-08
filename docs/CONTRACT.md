# 契约：数据结构与接口

类型定义以 `src/shared/model.ts` 为准，这里只做说明。改契约要先改那个文件，再同步这里。

## 数据文件

`<dataDir>/library.json`

```jsonc
{
  "version": 1,
  "goals":    [{ "id": "g_…", "name": "2027 法考", "examDate": "2027-09-15", "createdAt": "ISO" }],
  "subjects": [{ "id": "sub_…", "goalId": "g_…", "name": "刑法" }],
  "materials": [{
    "id": "m_…", "subjectId": "sub_…", "kind": "book | video", "title": "…",
    "file": "/abs/path.pdf", "pageCount": 254,      // 书
    "url": "https://www.bilibili.com/video/BV…",     // 视频
    "targetDate": "2026-12-31",
    "outlineSource": "bookmarks | ai | video | manual",
    "chapters": [{ "id": "c_…", "title": "第一讲", "sections": [
      { "id": "s_…", "title": "刑法的解释", "page": 12, "url": "…?p=2", "done": true, "doneAt": "ISO" }
    ]}],
    "createdAt": "ISO"
  }],
  "mistakes": [{
    "id": "x_…", "materialId": "m_…", "sectionId": "s_…",
    "question": "…", "answer": "…", "note": "…", "image": "x_….png",
    "status": "todo | mastered", "createdAt": "ISO"
  }]
}
```

规则：
- 每章至少一节（没有分节的章，自动生成同名节）。
- 重新生成目录时，章、节标题都相同的节保留完成状态。被删掉的节上挂的错题变为未归类。
- 删除目标、科目或资料会连带删除下级内容和错题。不会删除 PDF 原文件。

## HTTP 接口（前端 ↔ Host）

都挂在 Harness 的 `/api` 通道上（由 Harness 负责鉴权），前缀是 `/api/dsh-shelf/`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `library` | `{ rev, library, dataDir }` |
| GET | `rev` | `{ rev }`，前端每 1.5 秒轮询，变了就重新拉取 |
| POST | `op` | `{ op, args }` → `{ rev, result }`。op 白名单：addGoal updateGoal deleteGoal addSubject updateSubject deleteSubject addBook addVideo updateMaterial deleteMaterial setOutline setSectionDone markUpTo resetProgress updateMistake deleteMistake |
| GET | `pdf?id=` | PDF 原文件字节 |
| GET | `page-text?id=&pages=1,2` | `{ pages: [{page,text}], scanned: [页码] }` |
| GET | `image?name=` | 错题原图 |
| GET | `asset?f=cmaps/…` | 前端 pdf.js 需要的 CMap、字体、wasm |
| POST | `pick-file` | 弹出 macOS 文件选择框：`{ path }`，取消时为 null，非 macOS 为 undefined |
| POST | `open` | `{ materialId, sectionId? }` 或 `{ target: 'dataDir' }`，用系统程序打开。只打开书架里登记过的路径或链接 |
| POST | `active` | `{ sessionId, materialId \| null }`：某个对话当前在书架里打开的资料 |

业务错误返回 HTTP 400 和 `{ ok: false, error: "中文说明" }`。

## AI 工具

| 工具 | 作用 |
|---|---|
| `shelf_overview` | 列出全部内容的 id 和进度；传 `material_id` 时返回完整目录 |
| `shelf_add` | 新建目标、科目、书或视频课 |
| `shelf_read_pages` | 读 PDF 指定页的文字，并提示哪些页是扫描页 |
| `shelf_set_outline` | 写入两级目录 |
| `shelf_set_target_dates` | 批量设置目标日期 |
| `shelf_add_mistake` | 记错题。资料默认取当前对话在书架里打开的那本，节默认取当前节；`image` 填图片路径或 `sha256:` 附件 id |
