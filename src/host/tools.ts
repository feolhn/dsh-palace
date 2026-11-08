/**
 * 给 AI 用的工具。原则：AI 只做"非结构化 → 结构化"的事（读目录页、识别错题），
 * 其余操作用户在书架界面里点就行。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { findSection, paceOf, progressOf, type Library, type Material } from '../shared/model.ts'
import {
  addBook, addGoal, addMistake, addSubject, addVideo, material, setOutline, ShelfError, updateMaterial,
  type OutlineInput,
} from './ops.ts'
import { readPageTexts, SCANNED_THRESHOLD } from './pdf.ts'
import type { ShelfStore } from './store.ts'

/** 每个对话当前在书架里打开的资料（前端上报）。 */
export type ActiveMaterials = Map<string, string>

const stringOut = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

function label(lib: Library, m: Material): string {
  const subject = lib.subjects.find(s => s.id === m.subjectId)
  return `${subject?.name ?? '?'} ·《${m.title}》`
}

function describe(lib: Library, active: string | undefined): string {
  if (lib.goals.length === 0) return '书架是空的：还没有学习目标。'
  const lines: string[] = []
  for (const goal of lib.goals) {
    lines.push(`学习目标「${goal.name}」 id=${goal.id}${goal.examDate ? ` 考试日期 ${goal.examDate}` : ''}`)
    for (const subject of lib.subjects.filter(s => s.goalId === goal.id)) {
      lines.push(`  科目「${subject.name}」 id=${subject.id}`)
      for (const m of lib.materials.filter(x => x.subjectId === subject.id)) {
        const p = progressOf(m)
        const pace = paceOf(m)
        const mistakes = lib.mistakes.filter(x => x.materialId === m.id && x.status === 'todo').length
        lines.push(`    ${m.kind === 'book' ? '书' : '视频'}《${m.title}》 id=${m.id}`
          + ` 进度 ${p.done}/${p.total} 节`
          + (m.chapters.length === 0 ? '（还没有目录）' : '')
          + (m.targetDate ? ` 目标日期 ${m.targetDate}` : '')
          + (pace?.perDay !== undefined && pace.remaining > 0 ? ` 每天约 ${pace.perDay} 节` : '')
          + (m.pageCount ? ` 共 ${m.pageCount} 页` : '')
          + (p.current ? ` 当前：${p.current.chapter.title} › ${p.current.section.title}` : '')
          + (mistakes > 0 ? ` 待重做错题 ${mistakes}` : '')
          + (m.id === active ? '  ← 用户当前在书架里打开的资料' : ''))
      }
    }
  }
  return lines.join('\n')
}

function outlineText(m: Material): string {
  return m.chapters.map((c, i) => `${i + 1}. ${c.title}\n${c.sections.map(s => `   - ${s.title} (section_id=${s.id})`).join('\n')}`).join('\n')
}

async function guard(run: () => Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ShelfError) return `操作失败：${error.message}`
    throw error
  }
}

export function createTools(store: ShelfStore, active: ActiveMaterials) {
  const activeOf = (exec: { agent?: { id: string } }) => (exec.agent ? active.get(exec.agent.id) : undefined)

  return [
    defineTool({
      name: 'shelf_overview',
      description: '查看学习书架：所有学习目标、科目、资料（书/视频课）的 id、进度、目标日期，以及用户当前在书架里打开的是哪本。'
        + '涉及书架的任何操作前先调用它拿到 id。传 material_id 可查看该资料的完整目录（含 section_id）。',
      parameters: {
        material_id: { type: 'string', description: '可选：查看这本资料的完整目录' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => {
          const lib = store.get()
          if (args.material_id === undefined) return describe(lib, activeOf(exec))
          const m = material(lib, args.material_id)
          return `${label(lib, m)} 目录：\n${m.chapters.length === 0 ? '（还没有目录）' : outlineText(m)}`
        })
      },
    }),

    defineTool({
      name: 'shelf_add',
      description: '往书架里添加内容。kind=goal 新建学习目标（name，可选 exam_date）；kind=subject 在目标下新建科目（goal_id, name）；'
        + 'kind=book 添加 PDF 教材（subject_id, path 为 PDF 的绝对路径，可选 title、target_date）；'
        + 'kind=video 添加 B 站视频课（subject_id, url，可选 title、target_date）。日期格式 YYYY-MM-DD。',
      parameters: {
        kind: { type: 'string', enum: ['goal', 'subject', 'book', 'video'], required: true },
        name: { type: 'string', description: 'goal / subject 的名称' },
        exam_date: { type: 'string', description: 'goal 的考试日期' },
        goal_id: { type: 'string' },
        subject_id: { type: 'string' },
        path: { type: 'string', description: 'book：PDF 绝对路径' },
        url: { type: 'string', description: 'video：B 站链接' },
        title: { type: 'string' },
        target_date: { type: 'string', description: 'book / video 的目标完成日期' },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          switch (args.kind) {
            case 'goal': {
              const g = await addGoal(store, { name: args.name, examDate: args.exam_date })
              return `已新建学习目标「${g.name}」 id=${g.id}`
            }
            case 'subject': {
              if (args.goal_id === undefined) throw new ShelfError('缺少 goal_id')
              const s = await addSubject(store, { goalId: args.goal_id, name: args.name })
              return `已新建科目「${s.name}」 id=${s.id}`
            }
            case 'book': {
              if (args.subject_id === undefined) throw new ShelfError('缺少 subject_id')
              const m = await addBook(store, { subjectId: args.subject_id, file: args.path, title: args.title, targetDate: args.target_date })
              return `已添加《${m.title}》 id=${m.id}，共 ${m.pageCount} 页。`
                + (m.chapters.length > 0
                  ? `已从 PDF 书签读出目录：${m.chapters.length} 章 ${progressOf(m).total} 节。`
                  : '这本 PDF 没有书签，需要生成目录：请用户在书架里勾选目录页，或告诉你目录在第几页，然后用 shelf_read_pages 读取。')
            }
            case 'video': {
              if (args.subject_id === undefined) throw new ShelfError('缺少 subject_id')
              const m = await addVideo(store, { subjectId: args.subject_id, url: args.url, title: args.title, targetDate: args.target_date })
              return `已添加视频课《${m.title}》 id=${m.id}，共 ${progressOf(m).total} 集。`
            }
          }
        })
      },
    }),

    defineTool({
      name: 'shelf_read_pages',
      description: '读取书架里某本 PDF 指定页的文字（页码为 PDF 的页序号，从 1 开始，不是书上印的页码）。'
        + '用于读取目录页来生成章节结构。每次最多 30 页。',
      parameters: {
        material_id: { type: 'string', required: true },
        pages: { type: 'array', items: { type: 'integer' }, required: true, description: 'PDF 页序号列表' },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const m = material(store.get(), args.material_id)
          if (m.file === undefined) throw new ShelfError('这不是 PDF 资料')
          const pages = [...new Set(args.pages)].slice(0, 30)
          const texts = await readPageTexts(m.file, pages)
          const scanned = texts.filter(t => t.text.length < SCANNED_THRESHOLD).map(t => t.page)
          let out = texts.map(t => `=== 第 ${t.page} 页 ===\n${t.text || '（无文字）'}`).join('\n\n')
          if (scanned.length > 0) {
            out += `\n\n注意：第 ${scanned.join('、')} 页没有文字层（可能是扫描件）。`
              + '如果对话里附有这些页的图片，请直接看图识别；否则请用户在书架里重新勾选这些页（书架会把页面图片发到对话）。'
          }
          return out
        })
      },
    }),

    defineTool({
      name: 'shelf_set_outline',
      description: '写入（覆盖）资料的目录结构，只要两级：章 › 节。没有分节的章，sections 留空即可（会自动算作一节）。'
        + '标题保持原书写法，去掉页码和省略号。重新生成目录时，标题不变的节会保留完成状态。'
        + '页码 page 可选，填 PDF 页序号（书上印的页码 + 偏移量）；不确定就不填。',
      parameters: {
        material_id: { type: 'string', required: true },
        chapters: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', required: true },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string', required: true },
                    page: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const m = await setOutline(store, { id: args.material_id, chapters: args.chapters as OutlineInput[], source: 'ai' })
          return `已写入《${m.title}》目录：${m.chapters.length} 章 ${progressOf(m).total} 节。用户可以在书架里查看和勾选进度。`
        })
      },
    }),

    defineTool({
      name: 'shelf_set_target_dates',
      description: '设置资料的目标完成日期（YYYY-MM-DD），用于规划学习进度。可一次设置多本。'
        + '规划时参考学习目标的考试日期、各资料的节数，并给复习留出时间。设置前先和用户确认方案。',
      parameters: {
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              material_id: { type: 'string', required: true },
              target_date: { type: 'string', required: true },
            },
          },
        },
      },
      output: stringOut,
      async execute(args) {
        return guard(async () => {
          const lines: string[] = []
          for (const item of args.items as { material_id: string; target_date: string }[]) {
            const m = await updateMaterial(store, { id: item.material_id, targetDate: item.target_date })
            const pace = paceOf(m)
            lines.push(`《${m.title}》→ ${m.targetDate}` + (pace?.perDay !== undefined ? `，剩 ${pace.remaining} 节，每天约 ${pace.perDay} 节` : ''))
          }
          return `已设置：\n${lines.join('\n')}`
        })
      },
    }),

    defineTool({
      name: 'shelf_add_mistake',
      description: '把一道错题记进书架。用户发来错题截图并说"记错题"之类时调用：先看图把题目完整转成文字（含选项），'
        + '能判断的话把正确答案和解析写进 answer。'
        + 'image 填对话里这张图片的本地只读路径（图片说明中的 read-only path）；没有路径就填附件 id（sha256:...）。'
        + 'material_id 不填时，默认记到用户当前在书架里打开的资料；section_id 不填时，默认挂到当前在学的那一节。'
        + '如果题目明显属于别的章节，先用 shelf_overview 查目录再指定 section_id。图表复杂、文字说不清的题，question 写概要即可，原图会保存。',
      parameters: {
        question: { type: 'string', required: true, description: '题目文字（含选项）' },
        answer: { type: 'string', description: '正确答案与解析' },
        note: { type: 'string', description: '错因或备注（用户说了才填）' },
        image: { type: 'string', description: '截图的本地路径或附件 id' },
        material_id: { type: 'string' },
        section_id: { type: 'string' },
      },
      output: stringOut,
      async execute(args, exec) {
        return guard(async () => {
          const materialId = args.material_id ?? activeOf(exec)
          if (materialId === undefined) {
            throw new ShelfError('不知道记到哪本资料：用户没有在书架里打开资料。请先用 shelf_overview 查看后指定 material_id，或请用户在右侧书架打开对应的书。')
          }
          const { mistake, material: m, imageSaved } = await addMistake(store, {
            materialId, sectionId: args.section_id, question: args.question, answer: args.answer, note: args.note, image: args.image,
          })
          const where = findSection(m, mistake.sectionId)
          return `已记入${label(store.get(), m)}`
            + (where ? ` ${where.chapter.title} › ${where.section.title}` : '（未归类到章节）')
            + (imageSaved ? '，原图已保存。' : '。（没有保存到原图）')
            + ' 用户可在书架的错题页修改章节。'
        })
      },
    }),
  ]
}
