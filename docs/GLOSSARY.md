# 术语表 Glossary

本项目特有概念的中英文对照。讨论、代码、文档都按这里的叫法；新增概念先加到这里。设计讨论见 Discussions 置顶的目录帖。

## 界面

| 中文 | English | 代码里 | 含义 |
|---|---|---|---|
| 宫殿 | Palace | `Palace`、`.mp-*` | 整张画布，所有格子所在的首页 |
| 格子 | Cell | `Cell` | 宫殿里的一格。类型：书（有原文：PDF、EPUB、视频课）、笔记（没有原文）、分组 |
| 分组 | Group | `kind: 'group'` | 把一格拖到另一格上合成的格子，只能放在宫殿最外层 |
| 平面视图 | Flat view | — | 宫殿默认的俯视画布 |
| 轴测视图 | Isometric view | `.mp-iso` | 按 `I` 键切换的立体视图，可以看到电弧 |
| 阅览室 | Room | `.mp-room`、`src/client/notebook` | 点开一格后进入的页面，包含进度、卡片、灵感三页。早期叫「笔记本」，代码目录沿用 notebook |
| 进度 | Progress | `chapters`、`position` | 阅览室第一页，显示目录、读到哪、目标日期 |
| 章 › 节 | Chapter › Section | `Chapter` | 进度用的目录，只有两级，按节计数。没有分节的章本身算一节，视频的一集算一节 |
| 目标日期 | Target date | `targetDate` | 每格单独设。剩 N 节时，插件倒推每天约读几节 |
| 卡片 | Card | `Card` | 阅览室第二页的条目，分为摘录、想法、错题 |
| 摘录 | Excerpt | `type: 'excerpt'` | 书里的原话 |
| 想法 | Thought | `type: 'thought'` | 用户自己的话 |
| 错题 | Mistake | `type: 'mistake'` | 做错的题，状态分为待复习和已掌握 |
| 灵感 | Inspiration | `Inspiration` | 阅览室第三页的条目，由一次 AI 对话总结出的短文 |
| 分享卡片 | Share card | `src/client/share` | 把卡片排版成图片，方便分享 |
| 光球 | Orb | `.mp-orb` | 打开 AI 对话的入口（仅 Harness 版有）。样子跟着皮肤：水彩是透明的圆，像素是方块 |

## 记忆

| 中文 | English | 代码里 | 含义 |
|---|---|---|---|
| 记忆 | Memory | `src/core/memory.ts` | AI 对用户和格子的理解，由 AI 用工具写入 |
| 我 | Me page | `memory/me.md` | 关于用户的那一页记忆 |
| 格子页 | Cell page (wiki) | `memory/cells/<id>.md` | 每格一页的记忆：这一格对用户意味着什么 |
| 主题 | Topic | `topics` | 格子页上的几个短语，由 AI 自由书写，没有固定词库（#80） |
| 联想 | Link | `links.jsonl` 里的 `link` | AI 记下的一条「这两格为什么相关」，两端都要有证据 |
| 证据 | Evidence | `evidence` | 联想或格子页所依据的卡片和灵感 |
| 剪断 | Cut | `links.jsonl` 里的 `cut` | 用户断开两格之间的电弧，之后 AI 不能再自己连上 |
| 电弧 | Arc | `Arc`、`.mp-arc` | 宫殿里两格之间的连线，由有效的联想计算得出，不单独存储 |
| 欠账 | Debt | `debt()` | 一格里有多少条新记录还没被 AI 写进格子页 |
| 宫殿索引 | Palace index | `context()` | 每次对话自动注入的目录，每格一行：标题、一句话总结、主题词、最近活跃月份（#81） |

## 架构

| 中文 | English | 代码里 | 含义 |
|---|---|---|---|
| 宿主 | Host app | — | 运行插件的 AI 客户端：现在是 DeepSeek Harness，规划中有 Claude、ChatGPT |
| 核心 | Core | `src/core` | 业务逻辑与数据读写，只依赖 Node，不依赖任何宿主 |
| 宿主层 | Host layer | `src/host` | Harness 插件层：注册工具、注入记忆、提供 HTTP 接口 |
| 前端 | Client | `src/client` | React 写的宫殿界面 |
| 适配层 | Adapter | — | 某个宿主专用的薄层，例如 Harness 适配层、MCP 适配层（MCP 为规划中） |
| 能力 | Capabilities | `/api/capabilities`（规划中） | 宿主声明自己支持的功能，前端只看能力开关，不判断宿主 |
| 工具 | Tool | `palace_*` | 提供给 AI 调用的操作 |
| 数据目录 | Data dir | `dataDir` | 默认是 `~/Documents/dsh-palace-data` |
| 皮肤 | Theme | `vendor/themes/<id>/theme.json` | 一套背景、图标、字体和颜色，没有 CSS 和脚本。官方有水彩（默认）和像素两套，底栏按钮切换（#102） |
| 槽位 | Slot | `COLOR_SLOTS` | 皮肤里可以替换的位置：背景、格子图标、字体，和 ink、edge、ring 等颜色。用户自己替换槽位是下一步（#95） |
| 快照 | Snapshot | —（规划中） | 每天第一次写入前对数据目录的自动备份 |
| 演示站 | Demo site | `demo/` | 给新用户在线体验的静态网站：Core 跑在浏览器里，配上剧本和演示数据（以后做） |
| 演示数据 | Demo palace | `demo/palaces/`（规划中） | 一份数据目录快照加一份 `theme.json`，水彩和像素各一套 |
