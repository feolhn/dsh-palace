/**
 * 宫殿始终是浅色水彩（#65）：Harness 切到深色时，宫殿里嵌的原生对话也要用浅色。
 * 不改对话控件本身，只在宫殿根节点上把 Harness 的 --dsw-* 颜色变量设回浅色值（变量会继承给里面的对话）。
 * 浅色值直接从 Harness 自己的样式表里读（作用在 body、不带 data-ds-dark-theme 的规则），Harness 更新配色时跟着变。
 */
import type { CSSProperties } from 'react'

let cached: Record<string, string> | undefined

function collect(rules: CSSRuleList, out: Record<string, string>): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const light = rule.selectorText.split(',').some(sel => {
        const s = sel.trim()
        return !s.includes('data-ds-dark-theme') && /(^|\s)body$/.test(s) && document.body.matches(s)
      })
      if (!light) continue
      for (const name of Array.from(rule.style)) if (name.startsWith('--dsw-')) out[name] = rule.style.getPropertyValue(name).trim()
    } else if (rule instanceof CSSMediaRule) {
      if (matchMedia(rule.conditionText).matches) collect(rule.cssRules, out)
    } else if ('cssRules' in rule) {
      collect((rule as CSSGroupingRule).cssRules, out)
    }
  }
}

/** 浅色的 Harness 颜色变量 + color-scheme: light（EPUB 的 iframe、日期弹窗也跟着用浅色）。 */
export function lightScheme(): CSSProperties {
  if (cached === undefined) {
    const out: Record<string, string> = {}
    for (const sheet of Array.from(document.styleSheets)) {
      try { collect(sheet.cssRules, out) } catch { /* 跨域样式表读不了，跳过 */ }
    }
    // 没读到就先不缓存，下次再试（样式表可能还没加载完）
    if (Object.keys(out).length > 0) cached = out
    else return { colorScheme: 'light' }
  }
  return { ...cached, colorScheme: 'light' } as CSSProperties
}
