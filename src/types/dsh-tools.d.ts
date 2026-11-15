// @deepseek-ai/dsh-tools 由 Harness 运行时提供，npm 上没有类型包。这里只声明用到的部分。
declare module '@deepseek-ai/dsh-tools' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Args = Record<string, any>
  interface Exec { agent?: { id: string } }
  export function defineTool(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: unknown
    execute(args: Args, exec: Exec): Promise<string>
  }): unknown
}
