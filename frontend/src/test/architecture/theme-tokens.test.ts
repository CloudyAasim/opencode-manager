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
    const match = /^\s*(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line)
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
})
