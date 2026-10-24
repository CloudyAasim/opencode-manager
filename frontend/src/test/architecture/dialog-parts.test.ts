import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments, stringLiterals } from './source-text'

/**
 * 弹窗里的零件，只有共享的那几个。
 *
 * 三十多个弹窗里自己写着的东西有三样，而这三样都写着"同一个弹窗"的同一件事：
 *
 * - **字段的名字**：九个手写的 `<label>`，三种写法（`text-sm text-muted-foreground`、
 *   `text-sm font-medium`、`cursor-pointer text-sm text-foreground`），
 *   而仓库里明明有一个共享的 `Label`。反过来，那个共享的 `Label` 的字号又被
 *   调用点改了十一次——`text-xs sm:text-sm`（手机上 12px、桌面上 14px）、
 *   `text-base`（16px）、`text-xs`（12px）——**手机上的字段名比桌面上的小**。
 * - **底下的按钮行**：共享的 `DialogFooter` 写着 `sm:space-x-2 gap-2`——
 *   间距和间隙叠在一起，桌面上两个按钮之间 16px，手机上 8px。
 * - **右上角的关闭键**：绝对定位在 `right-4 top-1rem`，而框的留白是
 *   手机 16px、桌面 24px——它和标题的缩进对不齐。
 *
 * 判的是**形状**：这一处是共享的零件画的，还是某个弹窗自己写的。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的弹窗零件。 */
const SHARED = {
  label: 'components/ui/label.tsx',
  dialog: 'components/ui/dialog.tsx',
}

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

/**
 * 从 `<Tag` 到那个 `>`。
 *
 * 引号里的 `>` 不算：类名里可以有 `[&>svg]` 这样的选择器。
 */
function tagAt(text: string, start: number): string {
  let quote: string | null = null
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '>') return text.slice(start, index + 1)
  }
  return text.slice(start)
}

/** 一个标签自己带的类名。 */
function classListOf(text: string, tag: string): string[] {
  const found: string[] = []
  const matcher = new RegExp(`<${tag}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const opening = tagAt(text, match.index)
    const attrs = opening.slice(tag.length + 1, opening.endsWith('>') ? -1 : undefined)
    const literal = /className="([^"]*)"/.exec(attrs)?.[1]
    const expression = /className=\{([^}]*)\}/.exec(attrs)?.[1]
    found.push((literal ?? expression ?? '').replace(/\s+/g, ' ').trim())
  }
  return found
}

/**
 * 共享组件自己写的那一串类名。
 *
 * 共享的零件是函数（`const DialogFooter = ({...}) => (...)`），所以它的类名
 * 不在一个标签上——它在那个函数自己的 `cn(...)` 里。
 */
function sharedClassOf(name: string): string {
  for (const rel of Object.values(SHARED)) {
    const text = sourceOf(rel)
    const declaration = new RegExp(`(?:function|const)\\s+${name}\\b`).exec(text)
    if (!declaration) continue
    const body = text.slice(declaration.index, declaration.index + 1200)
    const single = /cn\(\s*'([^']*)'/.exec(body)?.[1]
    const double = /cn\(\s*"([^"]*)"/.exec(body)?.[1]
    return (single ?? double ?? '').replace(/\s+/g, ' ').trim()
  }
  return ''
}

/** 一档字号（Tailwind 的字号名）。 */
const SIZE_NAMES = ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl']

const sizesIn = (list: string): string[] =>
  list
    .split(/\s+/)
    .filter((token) => SIZE_NAMES.some((name) => token === `text-${name}`))

/** 一个工具类去掉变体前缀之后的样子。 */
function utilityOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1]!
}

describe('弹窗里的零件只有共享的那几个', () => {
  it('门禁自己看得见东西', () => {
    // 一道扫不到东西的门禁永远是绿的，一道认不出形状的门禁判的是别的事。
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 认得出字段名：共享的那一个，以及手写的那几个。
    expect(
      classListOf(sourceOf(SHARED.label), 'LabelPrimitive.Root').length,
      '认不出共享的字段名',
    ).toBeGreaterThan(0)
    expect(classListOf('const a = <label className="text-sm">x</label>', 'label').length).toBe(1)
    expect(sizesIn('text-sm font-medium'), '认不出字号').toEqual(['text-sm'])
    expect(sizesIn('text-foreground'), '把一个颜色类当成了字号').toEqual([])
  })

  it('字段的名字用共享的那一个', () => {
    // 仓库里明明有一个共享的 `Label`，却有九个手写的 `<label>`——
    // 同一个弹窗里的字段名和另一个弹窗里的长得不一样。
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (source.rel === SHARED.label) continue
      for (const list of classListOf(source.text, 'label')) {
        const line = source.text.split('\n').findIndex((l) => l.includes('<label'))
        offenders.push(`${source.rel}  ${list}`)
        void line
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了字段的名字：${offenders.length} 处`,
        ...offenders,
        '用共享的 <Label />。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享的字段名，字号是它自己的事', () => {
    // 调用点不改它的大小：改了就等于每个弹窗各有各的字段名，
    // 而 `text-xs sm:text-sm` 还让**手机上的字段名比桌面上的小**。
    //
    // 写的那一档若与共享的一样（`text-sm`），那只是把同一件事说了一遍，
    // 不算另一副画法；写成别的档就是。
    const shared = classListOf(sourceOf(SHARED.label), 'LabelPrimitive.Root')[0] ?? ''
    const sharedSizes = sizesIn(shared)
    expect(sharedSizes.length, '共享的字段名没有写明字号').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const source of SOURCES) {
      if (source.rel === SHARED.label) continue
      for (const list of classListOf(source.text, 'Label')) {
        const sizes = sizesIn(list)
        if (sizes.length === 0) continue
        if (sizes.every((size) => sharedSizes.includes(size))) continue
        offenders.push(`${source.rel}  ${list}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方改了共享字段名的字号：${offenders.length} 处`,
        ...offenders,
        '字段名的字号是共享那一个的事：两块屏幕上一样大。',
      ].join('\n'),
    ).toEqual([])
  })

  it('底部按钮行只有一档间距', () => {
    // `sm:space-x-2` 和 `gap-2` 叠在一起：桌面上两个按钮之间 16px，
    // 手机上 8px。间距只有一档，间隙就够了。
    const footer = sharedClassOf('DialogFooter')
    expect(footer, '认不出共享的底部按钮行').not.toBe('')

    expect(
      footer.split(/\s+/).filter((token) => utilityOf(token).startsWith('space-x-')),
      '共享的底部按钮行叠了两种间距',
    ).toEqual([])
    expect(
      footer.split(/\s+/).filter((token) => utilityOf(token) === 'gap-2'),
      '共享的底部按钮行没有写明那一档间距',
    ).toHaveLength(1)
  })

  it('框的上边距是留白加上安全区', () => {
    // 刘海是**加在**留白上面的，不是代替留白。
    //
    // 它以前是 `paddingTop: env(safe-area-inset-top, 0px)`——上边距被刘海
    // 顶掉了，于是桌面上（没有刘海）内容贴着框的上沿，而左右和下面还留着
    // 框的留白：同一个弹窗，上下两套缩进。
    const dialog = sourceOf(SHARED.dialog)
    const paddingTop = /paddingTop:\s*'([^']*)'/.exec(dialog)?.[1] ?? ''
    expect(paddingTop, '认不出框的上边距').not.toBe('')
    expect(paddingTop, '框的上边距没有把安全区算进去').toMatch(/env\(safe-area-inset-top/)
    expect(paddingTop, '框的上边距没有把留白算进去').toMatch(/var\(--dialog-margin/)
  })

  it('关闭键跟着框的留白走', () => {
    // 框的留白：手机 16px、桌面 24px。关闭键在框的右上角，
    // 它离框边的距离要和标题一样——否则标题缩进 24px、键缩进 16px。
    const dialog = sourceOf(SHARED.dialog)
    // 那个关掉手势用的隐藏按钮不算——它没有位置。
    const close = classListOf(dialog, 'DialogPrimitive.Close').filter((list) =>
      /(?:^|\s)(?:sm:)?right-\d+(\s|$)/.test(list),
    )
    expect(close.length, '认不出关闭键').toBeGreaterThan(0)

    const offsetOf = (list: string, side: 'right' | 'top'): number | null => {
      const token = list
        .split(/\s+/)
        .find((entry) => new RegExp(`^${side}-(\\d+)$`).test(entry))
      return token ? Number(new RegExp(`^${side}-(\\d+)$`).exec(token)![1]) : null
    }
    const wideOffsetOf = (list: string, side: 'right' | 'top'): number | null => {
      const token = list
        .split(/\s+/)
        .find((entry) => new RegExp(`^sm:${side}-(\\d+)$`).test(entry))
      return token ? Number(new RegExp(`^sm:${side}-(\\d+)$`).exec(token)![1]) : null
    }

    // 框的两副画法（卡片那一副与整屏那一副）带的是同一份留白。
    const variants = stringLiterals(dialog).filter((literal) => /left-\[50%\]/.test(literal))
    expect(variants.length, '认不出共享的框的那两副画法').toBeGreaterThan(1)
    for (const variant of variants) {
      const narrow = /(^|\s)p-(\d+)(\s|$)/.exec(variant)
      const wide = /(^|\s)sm:p-(\d+)(\s|$)/.exec(variant)
      expect(narrow, `框的这一副没有写明手机上的留白：${variant.slice(0, 50)}`).not.toBeNull()
      expect(wide, `框的这一副没有写明桌面上的留白：${variant.slice(0, 50)}`).not.toBeNull()

      for (const list of close) {
        expect(
          offsetOf(list, 'right'),
          `关闭键离右边 ${narrow![2]}px，框的留白是 ${narrow![2]}px`,
        ).toBe(Number(narrow![2]))
        expect(
          offsetOf(list, 'top'),
          `关闭键离上边 ${narrow![2]}px，框的留白是 ${narrow![2]}px`,
        ).toBe(Number(narrow![2]))
        expect(
          wideOffsetOf(list, 'right'),
          `关闭键在桌面上离右边 ${wide![2]}px，框的留白是 ${wide![2]}px`,
        ).toBe(Number(wide![2]))
        expect(
          wideOffsetOf(list, 'top'),
          `关闭键在桌面上离上边 ${wide![2]}px，框的留白是 ${wide![2]}px`,
        ).toBe(Number(wide![2]))
      }
    }
  })
})
