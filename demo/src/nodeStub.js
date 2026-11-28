// 浏览器里没有 node:fs 等：Core 在演示站只用来跑 ops 的纯逻辑，真碰到文件系统就报错
const none = () => { throw new Error('演示站没有文件系统') }
export const existsSync = none, mkdirSync = none, readFileSync = none, renameSync = none, rmSync = none, statSync = none,
  writeFileSync = none, appendFileSync = none
export const join = (...parts) => parts.join('/')
export const randomBytes = (n) => {
  const b = crypto.getRandomValues(new Uint8Array(n))
  return { toString: () => [...b].map(x => x.toString(16).padStart(2, '0')).join('') }
}
