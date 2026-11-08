/**
 * 书架数据存储：一个 library.json + images/ 目录，放在用户可见的文件夹里。
 * 所有修改都走 mutate()，串行执行、原子写入（先写临时文件再改名）。
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyLibrary, type Library } from '../shared/model.ts'

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export class ShelfStore {
  readonly dir: string
  readonly imagesDir: string
  private readonly file: string
  private library: Library
  private mtimeMs = 0
  /** 每次写入 +1，前端轮询它判断是否需要刷新。 */
  rev = 1
  private queue: Promise<unknown> = Promise.resolve()

  constructor(dir: string) {
    this.dir = dir
    this.imagesDir = join(dir, 'images')
    this.file = join(dir, 'library.json')
    mkdirSync(this.imagesDir, { recursive: true })
    this.library = this.readDisk()
  }

  private readDisk(): Library {
    if (!existsSync(this.file)) return emptyLibrary()
    const raw = readFileSync(this.file, 'utf8')
    this.mtimeMs = statSync(this.file).mtimeMs
    const parsed = JSON.parse(raw) as Partial<Library>
    return { ...emptyLibrary(), ...parsed, version: 1 }
  }

  /** 用户可能手动改了 library.json：文件变了就重新读。 */
  private refreshFromDisk(): void {
    if (!existsSync(this.file)) return
    const mtime = statSync(this.file).mtimeMs
    if (mtime === this.mtimeMs) return
    try {
      this.library = this.readDisk()
      this.rev += 1
    } catch (error) {
      // 手改坏了 JSON：保留内存里的版本，不覆盖用户文件
      console.warn('[dsh-shelf] library.json 解析失败，继续使用内存中的数据', error)
    }
  }

  get(): Library {
    this.refreshFromDisk()
    return this.library
  }

  /**
   * 串行执行一次修改。fn 直接修改传入的 library 副本；抛错则不落盘。
   * @returns fn 的返回值。
   */
  mutate<T>(fn: (library: Library) => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.refreshFromDisk()
      const draft = structuredClone(this.library)
      const result = await fn(draft)
      this.write(draft)
      this.library = draft
      this.rev += 1
      return result
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private write(library: Library): void {
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(library, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
    this.mtimeMs = statSync(this.file).mtimeMs
  }
}
