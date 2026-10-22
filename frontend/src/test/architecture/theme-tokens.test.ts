import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The two themes have to be two answers to the same question.
 *
 * A token that exists in one theme and not the other is not a style
 * decision, it is a hole: the one that misses it silently falls back to
 * whatever the browser decides, which is how a light card ends up with
 * white text on it in the dark theme and nobody can say when it started.
 *
 * The palette's identity is pinned as well. "Breeze" and "Breeze Ocean"
 * are specific colours, not a mood: Paper White on Cardboard Gray with
 * Plasma Blue, and the ocean window with the ocean blue. A gate that only
 * checked "the tokens exist" would let the whole palette be replaced by
 * another one and stay green, which is not protection - it is decoration.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const CSS_PATH = path.join(FRONTEND_SRC, 'index.css')

function readCss(): string {
  return fs.readFileSync(CSS_PATH, 'utf8')
}

/** The `--color-*` declarations of one block, by name. */
function tokensOf(css: string, blockStart: RegExp): Map<string, string> {
  const start = css.match(blockStart)
  expect(start, '没有找到这一段主题的样式').not.toBeNull()
  const body = css.slice(start!.index)
  const end = body.indexOf('\n}')
  const tokens = new Map<string, string>()
  for (const line of body.slice(0, end).split('\n')) {
    // The value can be a hex or an rgb() - the glass surfaces are
    // translucent and cannot be written as hex. A parser that only knew
    // about hex left every rgb() token out of the comparison below, which
    // is how a token could exist in one theme and not the other for a
    // whole release.
    const match = /^\s*(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;/.exec(line)
    if (match) tokens.set(match[1], match[2])
  }
  return tokens
}

/** The three channels of a hex colour, each 0..1. */
function channelsOf(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3
    ? value.split('').map((char) => char + char).join('')
    : value
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
}

function luminance(hex: string): number {
  const [r, g, b] = channelsOf(hex)
  const linear = [r, g, b].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('两个主题', () => {
  const dark = () => tokensOf(readCss(), /@theme\s*\{/)
  const light = () => tokensOf(readCss(), /:root:not\(\.dark\)\s*\{/)

  it('定义的令牌一模一样', () => {
    const darkNames = [...dark().keys()].sort()
    const lightNames = [...light().keys()].sort()

    expect(lightNames, '两个主题的令牌集合不同，缺的那个主题会自己决定颜色').toEqual(darkNames)
  })

  it('浅色是 Breeze：Paper White 卡片摆在 Cardboard Gray 上，主色是 Plasma Blue', () => {
    const tokens = light()

    expect(tokens.get('--color-background')).toBe('#eff0f1')
    expect(tokens.get('--color-card')).toBe('#fcfcfc')
    expect(tokens.get('--color-foreground')).toBe('#232629')
    expect(tokens.get('--color-muted-foreground')).toBe('#7f8c8d')
    expect(tokens.get('--color-border')).toBe('#bdc3c7')
    expect(tokens.get('--color-primary')).toBe('#3daee9')
  })

  it('深色是 Breeze Ocean：海洋的窗底，配海洋蓝的备用面', () => {
    const tokens = dark()

    expect(tokens.get('--color-background')).toBe('#1b2a33')
    expect(tokens.get('--color-card')).toBe('#141618')
    expect(tokens.get('--color-foreground')).toBe('#fcfcfc')
    expect(tokens.get('--color-primary')).toBe('#3daee9')
    expect(tokens.get('--color-primary-soft')).toBe('#1e5774')
  })

  it('主色上的字看得清', () => {
    // Plasma Blue is a light blue. White on it is 2.4:1 and fails; the
    // scheme's deep ink on it is 6.9:1 and passes. A button whose label
    // cannot be read is not a style question.
    for (const [name, tokens] of [['light', light()], ['dark', dark()]] as const) {
      const primary = tokens.get('--color-primary')!
      const foreground = tokens.get('--color-primary-foreground')!
      expect(
        contrast(foreground, primary),
        `${name} 主题的主按钮文字对比度不到 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('正文在自己的底色上看得清', () => {
    for (const [name, tokens] of [['light', light()], ['dark', dark()]] as const) {
      const ratio = contrast(tokens.get('--color-foreground')!, tokens.get('--color-background')!)
      expect(ratio, `${name} 主题的正文对比度不到 4.5:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('次要文字在自己的底色上不至于读不出来', () => {
    for (const [name, tokens] of [['light', light()], ['dark', dark()]] as const) {
      const ratio = contrast(tokens.get('--color-muted-foreground')!, tokens.get('--color-background')!)
      expect(ratio, `${name} 主题的次要文字对比度不到 3:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('悬停态上的字也看得清', () => {
    // The hover state is a different colour from the button, so the ink has
    // to clear the bar over that colour too. It used to be Icon Blue, which
    // is more saturated and darker: the ink on it fell from 6.9:1 to 5.6:1.
    for (const [name, tokens] of [['light', light()], ['dark', dark()]] as const) {
      const ratio = contrast(
        tokens.get('--color-primary-foreground')!,
        tokens.get('--color-primary-hover')!,
      )
      expect(ratio, `${name} 主题的主按钮悬停态文字对比度不到 4.5:1`).toBeGreaterThanOrEqual(4.5)

      expect(
        tokens.get('--color-primary-hover'),
        `${name} 主题的悬停态和主色一模一样，那不是悬停态`,
      ).not.toBe(tokens.get('--color-primary'))
    }
  })

  it('搜索命中的墨看得清', () => {
    for (const [name, tokens] of [['light', light()], ['dark', dark()]] as const) {
      const ratio = contrast(
        tokens.get('--color-match-foreground')!,
        tokens.get('--color-match')!,
      )
      expect(ratio, `${name} 主题的搜索命中对比度不到 4.5:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('开关的旋钮是纸白，两边一样', () => {
    // A dark knob on a bright blue track is not what a Plasma switch
    // looks like, and the knob is the one part the eye goes to.
    expect(light().get('--color-switch-thumb')).toBe('#fcfcfc')
    expect(dark().get('--color-switch-thumb')).toBe('#fcfcfc')
  })

  it('diff 的颜色就是方案里那几个颜色，不另起一套', () => {
    // Three spellings of the same green used to live in three files, which
    // is how a diff ends up with a green that does not match the green
    // beside it. The values are pinned so that cannot happen quietly.
    expect(light().get('--color-diff-add')).toBe('#1e8449')
    expect(light().get('--color-diff-remove')).toBe('#b0343f')
    expect(light().get('--color-diff-modify')).toBe('#b2501f')
    expect(light().get('--color-diff-info')).toBe('#1668a8')
    expect(dark().get('--color-diff-add')).toBe('#6ee7b7')
    expect(dark().get('--color-diff-remove')).toBe('#fca5a5')
    expect(dark().get('--color-diff-modify')).toBe('#fdbc4b')
    expect(dark().get('--color-diff-info')).toBe('#3daee9')
  })

  it('两个主题都认得玻璃面这个令牌', () => {
    // The glass surfaces are rgb(), and the parser used to skip those, so
    // this token could have been missing from a theme without anything
    // noticing.
    expect(light().get('--color-surface-glass')).toBeTruthy()
    expect(dark().get('--color-surface-glass')).toBeTruthy()
  })

  it('每一支状态色在自己的卡片上都看得清', () => {
    // The state colours are used as text on the card, so the bar is the
    // one that matters - not the one on the window. A purple that is a
    // shade too light reads as a smudge on white.
    const stateful = [
      '--color-diff-add',
      '--color-diff-remove',
      '--color-diff-modify',
      '--color-diff-info',
      '--color-diff-pushed',
      '--color-status-compact',
      '--color-worktree',
    ]
    for (const [name, tokens] of [['light', light()], ['dark', dark()]] as const) {
      for (const token of stateful) {
        const value = tokens.get(token)
        expect(value, `${name} 主题没有 ${token}`).toBeTruthy()
        expect(
          contrast(value!, tokens.get('--color-card')!),
          `${name} 主题的 ${token} 在卡片上不到 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
