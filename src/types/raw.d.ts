// esbuild 的 ?raw 插件：以文本形式导入
declare module '*?raw' {
  const text: string
  export default text
}
