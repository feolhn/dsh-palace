# Memory Palace（dsh-palace）· AGENTS

写给写代码的人和 AI。只写「现在是什么」和「必须遵守的规矩」，保持在 100 行以内。

- **为什么**（决策、争论）在 GitHub Discussions，入口是置顶的目录帖。
- **下一步做什么**在 Issues。
- 这里的规矩后面括号里的编号，指向对应的 Discussion，理由写在那里。

## 一句话

**懂你在想什么的 AI**：一张格子画布，书、课、剧、笔记都放在格子里。用户边记边和 AI 聊，AI 在后台把这些整理成记忆（#82）。

## 总原则

- **结构由我们和 AI 来维护，用户只管记。** 任何让用户先想好放哪、怎么分类的设计都要警惕。
- **less is more。** 不为小概率问题增加复杂度，不为「一切」预先设计（#79）。
- **代码规定形式，AI 决定内容。** 代码只规定「说有关系就要拿出证据」这类形式；判断交给 AI，用提示词里的判断标准来约束，不用人设，也不用 few-shot（#84）。

## 规矩

**个人信息**
- 提交前、发布前会自动运行 `scripts/check-privacy.mjs`。不要绕过它。
- `privacy.local.txt` 和 `*.local.md` 永远不提交。
- 提交邮箱使用 GitHub 的 noreply 地址。
- 截图里不能出现本机路径、头像或真名。设计负责人一律写作 `@bbhh1226`。

**宿主**
- 不改 DeepSeek Harness 和官方插件的代码。
- 官方的 AI 聊天控件只允许有限的样式套壳，不碰它的底层。

**流程**
- 每个改动都开短分支和 PR。GPT 审查后，Claude 逐条核实：真问题就修，概率很小的问题不修，避免堆出屎山。
- PR 由作者合并（建议 squash）。合并后从最新的 main 开新分支，不往已经合并的分支上推。
- 合并前跑 `pnpm verify`。改完代码就跑 `pnpm build`，因为作者本机的 Harness 直接读取仓库里的构建产物。
- `npm publish` 由作者自己执行。

**架构底线**（#79、#84）
- Core 只依赖 Node，不引用任何宿主的东西。
- 会话的概念不进 Core，处理函数一律显式接收格子 id。

以下几条是多宿主改造时要守的约束，**目前还没实现**，做到时再从这里删掉「待实现」：
- 待实现：工具只在 Core 里定义一次，各宿主从这里注册。现在工具定义在 `src/host/tools.ts`。
- 待实现：前端只看 `/api/capabilities` 返回的能力开关，不判断自己在哪个宿主里。
- 待实现：格子类型用注册表管理，不在前后端到处写类型判断。
- 待实现：用户设置放在数据目录的 `settings.json` 里。现在配置写在 `cordis.patch.yml`。
- 待实现：读到更高 `schema` 版本的数据时，只读不写。现在仍会被写回当前版本。
- localhost 只监听 127.0.0.1。

**记忆**（#80、#81）
- 优先改提示词，不加数据结构。不加 `topic` 字段，也不建主题词库。
- 电弧的 why 是图上的题词：从两端证据的原话，或用户自己说过的话里摘，不自己造句。
- 只有用户自己把两格连起来，或者认同了 AI 提出的联系，才连电弧。
- 「一直带着的」背景保持精简，细节交给工具按需去查，不加大注入量。

**文档**
- 改了数据格式、接口或工具，就在同一个 PR 里改 `docs/CONTRACT.md`。
- 改了用户能看到的功能或定位，就在同一个 PR 里改 `README.md`。发版打 tag 前，再通读一遍 README，确认和现状一致。
- 新概念加进 `docs/GLOSSARY.md`，讨论和代码都按那里的叫法。
- 想新增文档或根目录条目时，先问它属于「为什么」还是「是什么」：前者发 Discussion，后者并进现有文档。

## 当前架构

```
src/core     业务逻辑和数据读写（store、ops、memory），只依赖 Node
src/host     DeepSeek Harness 适配层：注册 palace_* 工具、注入记忆、HTTP 接口
src/client   React 界面：宫殿、阅览室、阅读器、分享卡片；只通过 src/client/api.ts 调后端
src/shared   前后端共用的数据类型
```

- **数据目录**默认在 `~/Documents/dsh-palace-data/`，包含 `palace.json`、`items/`、`images/`、`memory/`（me.md 和格子页）、`links.jsonl`（联想）。详见 `docs/CONTRACT.md`。
- **宿主**：现在只有 DeepSeek Harness。以后会加 MCP（Claude 和 ChatGPT 桌面端）、localhost 网页，以及演示站（`demo/`：一座只读的宫殿，访客自己逛；宫殿和阅览室用插件的真实组件，数据在 `demo/data/`，格式和真实数据目录一样，另加 `chats.json` 放聊天记录，#107）。

## 地图

| 位置 | 内容 |
|---|---|
| `README.md` | 给用户：怎么装、怎么用 |
| `docs/CONTRACT.md` | 数据格式、HTTP 接口、AI 工具 |
| `docs/GLOSSARY.md` | 术语的中英文对照 |
| `src/` `test/` `scripts/` | 代码、测试、构建和检查脚本 |
| `vendor/` | 随包发布的字体、阅读器脚本和皮肤（`vendor/themes/<id>/`：theme.json、图标、背景） |
| `assets/` | README 和插件市场用的演示动图（路径写在 `screenshots.json` 里，不要挪动） |
| `cordis.patch.yml` `screenshots.json` | 宿主和插件市场从根目录读取，必须留在根目录 |
| Discussions 置顶目录帖 | 所有设计讨论和决策存档 |

## 语言

用简体中文回复，代码注释写中文，必要时加英文术语。
