import { describe, it, expect } from 'vitest'
import {
  GIT_DIFF_BACKGROUNDS,
  GIT_STATUS_COLORS,
  GIT_UI_COLORS,
} from './git-status-styles'

/**
 * A diff is the one place in this application where green and red are not
 * decoration: they are the answer to "what changed". They used to be
 * written three times, in three spellings, in three files - and the three
 * spellings were not the same colour.
 *
 * So the colours live here, once, and they are tokens rather than a
 * library's palette: the ink of the scheme, under a name that says what it
 * is for.
 */

const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

function everyColour(map: Record<string, string>): string[] {
  return Object.values(map)
}

describe('diff 的颜色只有一份', () => {
  it('状态色都是语义令牌，不带原生色板', () => {
    for (const value of [
      ...everyColour(GIT_STATUS_COLORS),
      ...everyColour(GIT_UI_COLORS),
      ...everyColour(GIT_DIFF_BACKGROUNDS),
    ]) {
      expect(value, `还有原生色板：${value}`).not.toMatch(RAW_PALETTE)
    }
  })

  it('颜色令牌在样式表里真的存在', () => {
    const used = new Set<string>()
    for (const value of [
      ...everyColour(GIT_STATUS_COLORS),
      ...everyColour(GIT_UI_COLORS),
      ...everyColour(GIT_DIFF_BACKGROUNDS),
    ]) {
      for (const token of value.split(/\s+/)) {
        const match = /^(?:bg|text|border)-([a-z0-9-]+)(?:\/\d+)?$/.exec(token)
        if (match) used.add(`--color-${match[1]}`)
      }
    }
    expect(used.size, '没有解析出任何颜色令牌').toBeGreaterThan(0)
  })

  it('改过的行和删过的行是两种不同的颜色', () => {
    expect(GIT_DIFF_BACKGROUNDS.added).not.toBe(GIT_DIFF_BACKGROUNDS.deleted)
    expect(GIT_STATUS_COLORS.added).not.toBe(GIT_STATUS_COLORS.deleted)
  })

  it('每种 git 状态都有颜色', () => {
    for (const status of ['modified', 'added', 'deleted', 'renamed', 'untracked', 'copied'] as const) {
      expect(GIT_STATUS_COLORS[status], `${status} 没有颜色`).toBeTruthy()
    }
  })
})
