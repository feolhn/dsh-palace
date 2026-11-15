// node --import ./test/stubs/register.mjs：把 @deepseek-ai/dsh-tools 指到测试替身
import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') return { url: new URL('./dsh-tools.mjs', ${JSON.stringify(import.meta.url)}).href, shortCircuit: true }
  return next(specifier, context)
}`))
