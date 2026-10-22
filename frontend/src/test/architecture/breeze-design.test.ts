import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stringLiterals, stripComments } from './source-text'

/**
 * Breeze's geometry, written down as rules that can be broken.
 *
 * A palette is the easy half of a design system: it is a list of values, and
 * changing it changes every screen at once. The other half is the shape of
 * the things on the screen - how round a corner is, how much room a button
 * gives its label, whether the spacing lands on a grid, whether a panel
 * floats above the page or is painted into it.
 *
 * Those are the parts that drift. One dialog gets a bigger radius, one
 * input gets tighter padding, one dropdown stays solid while its four
 * siblings turned to glass, and a year later there is no geometry left to
 * speak of.
 *
 * So this file states the geometry, checks it, and says out loud what it
 * does not cover.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const CSS_PATH = path.join(FRONTEND_SRC, 'index.css')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const CSS = fs.readFileSync(CSS_PATH, 'utf8')

/* ------------------------------------------------------------------ *
 * Reading the stylesheet
 * ------------------------------------------------------------------ */

/** The declarations of one `@theme` / `:root` block, by name. */
function themeBlock(open: RegExp): Map<string, string> {
  const start = CSS.match(open)
  expect(start, 'index.css 里没有找到这一段主题').not.toBeNull()
  const body = CSS.slice(start!.index)
  const end = body.indexOf('\n}')
  const tokens = new Map<string, string>()
  for (const line of body.slice(0, end).split('\n')) {
    const match = /^\s*(--[a-z0-9-]+):\s*([^;]+);/.exec(line)
    if (match) tokens.set(match[1]!, match[2]!.trim())
  }
  return tokens
}

/** Every CSS block, as its selector and its body. */
function cssBlocks(): Array<{ selector: string; body: string }> {
  const blocks: Array<{ selector: string; body: string }> = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(CSS)) !== null) {
    blocks.push({ selector: match[1]!.trim(), body: match[2]! })
  }
  return blocks
}

/* ------------------------------------------------------------------ *
 * Reading the class lists
 * ------------------------------------------------------------------ */

const QUOTED_LOOKALIKE = /^(?:flex|grid|inline-flex|items-|h-|w-|p[xytrb]?-|m[xytrb]?-|rounded-|bg-|text-|border|gap-|absolute|fixed|relative)\S*/

/** Every string in a file that looks like a class list. */
function classListsOf(text: string): string[] {
  return stringLiterals(text).filter((value) =>
    value.split(/\s+/).some((token) => QUOTED_LOOKALIKE.test(token)),
  )
}

/** The utility part of a class, with the variants (`hover:`, `md:`) removed. */
function utilityOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1]!
}

/**
 * A Tailwind spacing value in pixels.
 *
 * Tailwind v4 derives the whole scale from one base, `--spacing: 0.25rem`,
 * so `py-2` is two steps of 4px and `py-1.5` is one and a half. The
 * arbitrary form (`pb-[200px]`) is taken at face value.
 */
function spacingPx(value: string): number | null {
  if (value === 'px') return 1
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value)
  if (arbitrary) return Number(arbitrary[1])
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric * 4
}

/** The vertical padding a class list declares, in pixels, or null. */
function verticalPaddingPx(list: string): number | null {
  let best: number | null = null
  for (const token of list.split(/\s+/)) {
    const utility = utilityOf(token)
    let value: string | null = null
    if (/^py-/.test(utility)) value = utility.slice(3)
    else if (/^p-/.test(utility)) value = utility.slice(2)
    if (value === null) continue
    const px = spacingPx(value)
    if (px === null) continue
    if (best === null || px > best) best = px
  }
  return best
}

/** The vertical size a class list declares, in pixels, or null. */
function verticalSizePx(list: string): number | null {
  let best: number | null = null
  for (const token of list.split(/\s+/)) {
    const utility = utilityOf(token)
    let value: string | null = null
    if (/^min-h-/.test(utility)) value = utility.slice(6)
    else if (/^size-/.test(utility)) value = utility.slice(5)
    else if (/^h-/.test(utility)) value = utility.slice(2)
    if (value === null) continue
    const px = spacingPx(value)
    if (px === null) continue
    if (best === null || px > best) best = px
  }
  return best
}

/** Whether a class list carries a class with the given prefix. */
function hasUtility(list: string, prefix: string): boolean {
  return list.split(/\s+/).some((token) => utilityOf(token).startsWith(prefix))
}

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

/**
 * The corner radius scale.
 *
 * Breeze is geometric rather than bubbly: a frame is about 8px, a dialog
 * about 12px, a chip 4px. One scale, used everywhere, is what "modern and
 * soft" means - soft is the relationship between the steps, not a bigger
 * number. The scale used to run 6/8/12/16, one step rounder than this,
 * which made every card read as a pill.
 */
const EXPECTED_RADIUS: ReadonlyArray<readonly [string, string]> = [
  ['--radius-sm', '0.25rem'],
  ['--radius-md', '0.375rem'],
  ['--radius-lg', '0.5rem'],
  ['--radius-xl', '0.75rem'],
]

/**
 * The form controls KDE's guidance is written about: buttons and text
 * fields. A switch or a checkbox is not in this list - they are toggles
 * with a shape of their own, and their size is the rule for them.
 */
const FORM_CONTROLS = [
  'components/ui/button.tsx',
  'components/ui/input.tsx',
  'components/ui/textarea.tsx',
  'components/ui/select.tsx',
] as const

/**
 * The floating surfaces that are not panels.
 *
 * Breeze's widgets sit on a blurred background, so a panel that only looks
 * frosted is not frosted. A *panel* is what floats: it has a place above
 * the page (a z-index), edges (a radius or a border) and a surface of its
 * own.
 *
 * The things below are floating too, and they are not panels: a label, a
 * button, a badge, a drop target. Each one is here with the reason, and
 * with the number of them - so a second panel appearing in one of these
 * files has to be declared as well, instead of slipping in under the
 * exemption.
 */
const NOT_A_PANEL = new Map<string, { reason: string; count: number }>([
  ['components/ui/tooltip.tsx', { reason: '提示条是一行字，不是浮起来的板', count: 1 }],
  [
    'features/file-browser/FileBrowserView.tsx',
    { reason: '这是拖放区的虚线框，不是浮层', count: 1 },
  ],
  [
    'features/file-browser/MobileFilePreviewModal.tsx',
    { reason: '这是浮在预览上的一个图标按钮', count: 1 },
  ],
  [
    'features/message/PromptInput.tsx',
    { reason: '这是发送按钮，红色是危险色，不是浮层', count: 1 },
  ],
  ['pages/SessionDetail.tsx', { reason: '这是浮在会话标题上的一个徽章', count: 1 }],
])

/** Whether a class list describes something that floats above the page. */
function isFloatingPanel(list: string): boolean {
  const utilities = list.split(/\s+/).map(utilityOf)
  const hasZ = utilities.some((utility) => /^z-\[?\d/.test(utility))
  if (!hasZ) return false
  const hasEdges = utilities.some(
    (utility) => utility.startsWith('rounded-') || utility.startsWith('border'),
  )
  if (!hasEdges) return false
  return utilities.some((utility) => utility.startsWith('bg-'))
}

/** The class lists in a file that float above the page as panels. */
function floatingPanelsOf(rel: string): string[] {
  return classListsOf(sourceOf(rel)).filter(isFloatingPanel)
}

/**
 * The panels Plasma 6 floats off the screen edge.
 *
 * In Plasma the panel floats when there is room for it and docks back to
 * the edge when there is not. A web page has no maximised window to dock
 * for, so the room decides - and both the bar and the status strip have to
 * answer the same way, or the window has a floating top and a stuck
 * bottom.
 */
const FLOATING_PANELS = ['framework/shell/TopBar.tsx', 'framework/shell/StatusBar.tsx'] as const

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

describe('Breeze 几何', () => {
  it('圆角刻度是 Breeze 的那一套', () => {
    const tokens = themeBlock(/@theme\s*\{/)

    for (const [name, value] of EXPECTED_RADIUS) {
      expect(tokens.get(name), `${name} 不是 Breeze 的圆角`).toBe(value)
    }

    const inPx = EXPECTED_RADIUS.map(([name]) => Number(tokens.get(name)!.replace('rem', '')) * 16)
    for (let index = 1; index < inPx.length; index += 1) {
      expect(inPx[index]!, '圆角刻度必须一级比一级大').toBeGreaterThan(inPx[index - 1]!)
    }
    expect(Math.max(...inPx), 'Breeze 的框不超过 12px 圆角').toBeLessThanOrEqual(12)
  })

  it('按钮和文本框内部至少留 8px 的空当', () => {
    for (const rel of FORM_CONTROLS) {
      const lists = classListsOf(sourceOf(rel))

      const breathing = lists.filter((list) => (verticalPaddingPx(list) ?? 0) >= 8)
      expect(
        breathing.length,
        `${rel} 里没有任何一处留出 8px 以上的内部空间`,
      ).toBeGreaterThan(0)

      const cramped = lists.filter((list) => {
        const padding = verticalPaddingPx(list)
        if (padding === null) return false
        if (padding < 2 || padding >= 8) return false
        return verticalSizePx(list) !== null
      })
      expect(
        cramped,
        [
          `${rel} 里有控件既挤（内部只有 2-7px）又自己撑了高度，挤的是里面那一层`,
          ...cramped.map((list) => `  ${list}`),
        ].join('\n'),
      ).toEqual([])
    }
  })

  it('间距落在 4px 网格上', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      const pattern = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-\[(\d+(?:\.\d+)?)px\]/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source.text)) !== null) {
        const value = Number(match[1])
        if (value % 4 === 0) continue
        offenders.push(`${source.rel}  ${match[0]}`)
      }
    }
    expect(
      offenders,
      [
        '这些间距不是 4 的倍数，界面就没有网格可言：',
        ...offenders,
      ].join('\n'),
    ).toEqual([])
  })

  it('全站图标用同一个线宽', () => {
    const weights = CSS.match(/stroke-width\s*:\s*[^;]+;/g) ?? []
    expect(weights.length, '样式表里没有统一图标线宽的声明').toBe(1)

    const iconBlock = cssBlocks().find(
      (block) => block.body.includes('stroke-width') && block.selector.includes('lucide'),
    )
    expect(iconBlock, '图标线宽的声明没有落在图标自己的类上').toBeDefined()

    const weight = Number(/stroke-width\s*:\s*([0-9.]+)/.exec(iconBlock!.body)![1])
    // Lucide draws its icons at 2. Breeze draws them finer, and "finer than
    // the library" is the rule - not a number that could be nudged up to
    // the library's own weight without anybody noticing.
    expect(weight, '图标线宽不比图标库自己的默认更细').toBeLessThan(2)

    const withProp = SOURCES.filter((source) => /\bstrokeWidth\s*=/.test(source.text))
    expect(
      withProp.map((source) => source.rel),
      '组件自己设了 strokeWidth，会盖掉样式表里的统一线宽',
    ).toEqual([])

    const iconImports = SOURCES.filter((source) => /from ['"]lucide-react['"]/.test(source.text))
    expect(iconImports.length, '仓库里已经没有 lucide-react 的图标了，线宽那条规则要重新找落点').toBeGreaterThan(0)
  })

  it('浮层是玻璃，不是实心板', () => {
    const solid: string[] = []
    const found: string[] = []

    for (const source of SOURCES) {
      const panels = floatingPanelsOf(source.rel)
      if (panels.length === 0) continue
      found.push(source.rel)

      const exemption = NOT_A_PANEL.get(source.rel)
      const notGlass = panels.filter(
        (list) =>
          !hasUtility(list, 'bg-surface-glass') || !hasUtility(list, 'backdrop-blur'),
      )
      if (notGlass.length === 0) continue

      if (!exemption) {
        solid.push(`${source.rel}  ${notGlass[0]}`)
        continue
      }
      if (notGlass.length !== exemption.count) {
        solid.push(
          `${source.rel}  例外只准 ${exemption.count} 个浮层，这里有 ${notGlass.length} 个`,
        )
      }
    }

    expect(
      solid,
      [
        '这些浮起来的板还是实心的：Breeze 的部件是坐在一层模糊的背景上的，',
        '看起来像磨砂但不是磨砂的板，等于没有这一层。',
        ...solid,
      ].join('\n'),
    ).toEqual([])

    expect(found.length, '一个浮层都没扫到，这道门禁没有判别力').toBeGreaterThan(5)
  })

  it('例外都写明了为什么，而且数量对得上', () => {
    for (const [rel, exemption] of NOT_A_PANEL) {
      expect(exemption.reason.trim().length, `${rel} 没有写为什么可以不是玻璃`).toBeGreaterThan(0)
      const panels = floatingPanelsOf(rel)
      expect(panels.length, `${rel} 已经不浮了，这条例外该删`).toBeGreaterThan(0)
    }
  })

  it('顶栏和状态栏是一对浮动的面板', () => {
    for (const rel of FLOATING_PANELS) {
      const lists = classListsOf(sourceOf(rel))
      const floating = lists.filter((list) => hasUtility(list, 'bg-surface-glass'))
      expect(floating.length, `${rel} 没有浮起来的那一面`).toBeGreaterThan(0)
      expect(
        floating.some((list) => hasUtility(list, 'rounded-')),
        `${rel} 浮起来却没有圆角，那只是一条没有贴边的横条`,
      ).toBe(true)
      expect(
        floating.some(
          (list) =>
            hasUtility(list, 'mx-') || hasUtility(list, 'mt-') || hasUtility(list, 'mb-'),
        ),
        `${rel} 浮起来却还贴着屏幕边`,
      ).toBe(true)
    }
  })
})

describe('这道门禁自己', () => {
  it('看得见文件', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
  })

  it('认得出类名', () => {
    expect(classListsOf('const a = "flex h-9 rounded-lg px-3 py-2"').length).toBe(1)
    expect(classListsOf('const a = "hello world"').length).toBe(0)
  })

  it('读得完整：类名里自己带引号', () => {
    // The class list that broke the first version of this gate: a quote of
    // its own inside a double-quoted string. Read up to the next quote, the
    // literal ends early and the class list is never seen at all.
    const source = 'const a = "[&_svg:not([class*=\'size-\'])]:size-4 px-3 py-2"'
    const lists = classListsOf(source)
    expect(lists.length).toBe(1)
    expect(verticalPaddingPx(lists[0]!)).toBe(8)
  })

  it('不把散文里的撇号当成字符串', () => {
    expect(stringLiterals("<p>don't stop</p>").length).toBe(0)
    expect(stringLiterals('const a = "text"').length).toBe(1)
  })

  it('注释里的类名不算数', () => {
    const source = '// bg-green-600 was here\nconst a = "flex"'
    expect(stripComments(source)).not.toContain('bg-green-600')
  })

  it('算得出内边距和高度', () => {
    expect(verticalPaddingPx('flex h-9 px-3 py-2')).toBe(8)
    expect(verticalPaddingPx('flex h-9 px-3')).toBeNull()
    expect(verticalPaddingPx('flex px-3 py-1.5')).toBe(6)
    expect(verticalSizePx('flex h-9 w-full')).toBe(36)
    expect(verticalSizePx('flex size-5')).toBe(20)
    expect(verticalSizePx('flex h-dvh')).toBeNull()
  })

  it('分得出变体前缀', () => {
    expect(utilityOf('hover:bg-accent/50')).toBe('bg-accent/50')
    expect(utilityOf('data-[state=checked]:bg-primary')).toBe('bg-primary')
    expect(verticalPaddingPx('hover:py-1 md:py-3')).toBe(12)
  })

  it('读得出样式表里的块', () => {
    const blocks = cssBlocks()
    expect(blocks.length, '样式表里一个块都没读到').toBeGreaterThan(10)
    expect(
      blocks.some((block) => block.selector.includes('lucide') && block.body.includes('stroke-width')),
      '认不出图标线宽那条规则',
    ).toBe(true)
  })
})
