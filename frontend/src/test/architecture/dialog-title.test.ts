import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * 弹窗的顶栏，在每一块屏幕上都是同一副。
 *
 * 上两轮定了"标题是什么"：页面标题是共享 `Header` 画的 `<h1>`（20px），
 * 小节标题是 `<h2>`（18px）。这一轮到**弹窗**。
 *
 * 三十多个弹窗的顶栏有两副画法：一副是共享的 `DialogHeader`（标题、说明，
 * 上下排），一副是 `DialogTitleBar`（同一对东西，外面套一条分隔线和一格
 * 右边放按钮的位置）。它们之间真正的差别不是标签，是**手机上的样子**：
 *
 * - 共享的 `DialogHeader` 写的是 `text-center sm:text-left`——**手机上把
 *   标题和说明居中**，桌面上左对齐。同一个弹窗，两块屏幕上两种排法。
 *   带图标的标题看不出来（图标那一行是 flex，文字靠左），不带图标的标题
 *   就是真的居中；而**说明永远是居中的**。
 * - 标题的字号也不齐：`OpenCodeConfigEditor` 的标题是
 *   `text-lg font-semibold sm:text-xl`——**手机上 18px、桌面上 20px**，
 *   手机版反而更小。
 * - 标题和说明之间的距离也不齐：普通那套 6px，`DialogTitleBar` 那一套
 *   是 0（说明紧贴着标题）。
 *
 * 手机不是旧的设计（`mobile-plasma.test.ts` 的论点）：所以顶栏在窄屏上
 * 不再居中，标题在每一块屏幕上一样大，标题和说明之间一样远。
 *
 * 判的是**形状**：这一副顶栏是共享的组件画的，还是某个弹窗自己写的。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的弹窗零件：顶栏的形状是它们画的。 */
const SHARED_DIALOG_PARTS = [
  'components/ui/dialog.tsx',
  'components/ui/dialog-layout.tsx',
]

/**
 * 顶栏的内边距，谁自己写了。
 *
 * 一个弹窗在手机上占满整屏时，框是**没有**内边距的（`mobileFullscreen`
 * 那一支就是 `p-0`）——那时候顶栏得自己带一格。于是有五个弹窗各自写了一
 * 份。这里把它们记下来，是为了让**第六个**不能悄悄地再写一份：名字、理由、
 * 文件，都在这里。
 */
const OWN_PADDING: ReadonlyArray<readonly [string, string]> = [
  [
    'features/repos/AddRepoDialog.tsx',
    '这个弹窗在手机上占满整屏，而整屏的框没有内边距——顶栏得自己带一格',
  ],
  [
    'features/repos/DirectoryPickerDialog.tsx',
    '同上',
  ],
  ['features/repos/RepoMcpDialog.tsx', '同上'],
  ['features/settings/GitCredentialDialog.tsx', '同上'],
  ['framework/commands/CommandPalette.tsx', '命令面板在手机上占满整屏，而整屏的框没有内边距'],
]

/**
 * Tailwind 的字号刻度，外加这个仓库自己加的一级微字号。
 */
const SIZE_CLASSES = [
  'text-2xs',
  'text-xs',
  'text-sm',
  'text-base',
  'text-lg',
  'text-xl',
  'text-2xl',
  'text-3xl',
  'text-4xl',
]

/** 对齐的工具类。 */
const ALIGN_CLASSES = ['text-left', 'text-center', 'text-right', 'text-start', 'text-end', 'text-justify']

/** 画一条线的工具类。 */
const RULE_CLASSES = ['border', 'border-b', 'border-t', 'border-l', 'border-r']

/** 弹窗的标题那一档字号：和 `SectionHeader` 一样。 */
const DIALOG_TITLE_SIZE = 'text-lg'

/** 一个工具类去掉变体前缀之后的样子。 */
function utilityOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1]!
}

function hasUtility(list: string, name: string): boolean {
  return list.split(/\s+/).some((token) => utilityOf(token) === name)
}

function sizesIn(list: string): string[] {
  return list.split(/\s+/).filter((token) => SIZE_CLASSES.includes(utilityOf(token)))
}

function alignmentsIn(list: string): string[] {
  return list.split(/\s+/).filter((token) => ALIGN_CLASSES.includes(utilityOf(token)))
}

function rulesIn(list: string): string[] {
  return list.split(/\s+/).filter((token) => RULE_CLASSES.includes(utilityOf(token)))
}

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

/**
 * 顶栏的零件，一次用法。
 */
interface Usage {
  rel: string
  part: string
  /** 顶栏自己带的 class（`DialogHeader` 的 `className`）。 */
  headerClasses: string
  /** 标题自己带的 class（`DialogTitle` 的 `className`、`DialogTitleBar` 的 `titleClassName`）。 */
  titleClasses: string
}

/**
 * 一处用法。
 *
 * 属性可能横跨好几行，所以标签要一直读到那个 `>`——引号里的 `>` 不算
 * （类名里可以有 `[&>svg]` 这样的选择器）。
 */
function usagesOf(text: string, part: string): Usage[] {
  const found: Usage[] = []
  const matcher = new RegExp(`<${part}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const tag = tagAt(text, match.index)
    const attrs = tag.slice(part.length + 1, tag.endsWith('>') ? -1 : undefined)
    const className = /className="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const titleClassName = /titleClassName="([^"]*)"/.exec(attrs)?.[1] ?? ''
    found.push({
      rel: '',
      part,
      headerClasses: part === 'DialogHeader' ? className : '',
      titleClasses: part === 'DialogTitleBar' ? titleClassName : className,
    })
  }
  return found
}

/** 从 `<DialogHeader` 到那个 `>`。 */
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

/**
 * 一个函数自己的那一段。
 *
 * 判的是"这个组件做了什么"，不是"这个文件里有没有出现过某个字符串"——
 * `DialogTitleBar` 那一列有没有自己排它的孩子，要看它自己的那一段。
 */
function bodyOf(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const rest = text.slice(start + 1)
  const next = rest.search(/\n(?:function|interface|const|export)\s/)
  return next === -1 ? rest : rest.slice(0, next)
}

/** 全部弹窗顶栏零件的用法（共享组件自己的除外）。 */function everyUsage(): Usage[] {
  const parts = ['DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogTitleBar']
  const found: Usage[] = []
  for (const source of SOURCES) {
    if (SHARED_DIALOG_PARTS.includes(source.rel)) continue
    for (const part of parts) {
      for (const usage of usagesOf(source.text, part)) {
        found.push({ ...usage, rel: source.rel })
      }
    }
  }
  return found
}

/**
 * 共享组件自己写的那一串 class。
 *
 * 共享的 `DialogTitle` 把自己的类名写在 `cn("…", className)` 里，
 * `DialogHeader` 也是——所以找的是它自己那一串，不是它渲染出去的标签。
 */
function sharedClassOf(part: string): string {
  for (const rel of SHARED_DIALOG_PARTS) {
    const text = sourceOf(rel)
    const declaration = new RegExp(`(?:function|const)\\s+${part}\\b`).exec(text)
    if (!declaration) continue
    const body = text.slice(declaration.index)
    const single = /cn\(\s*'([^']*)'/.exec(body)?.[1]
    if (single !== undefined) return single
    const double = /cn\(\s*"([^"]*)"/.exec(body)?.[1]
    if (double !== undefined) return double
    const literal = /className="([^"]*)"/.exec(body)?.[1]
    if (literal !== undefined) return literal
  }
  return ''
}

const usages = everyUsage()

describe('弹窗的顶栏只有一副', () => {
  it('门禁自己看得见东西', () => {
    // 一道扫不到东西的门禁永远是绿的，一道认不出形状的门禁判的是别的事。
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    expect(usages.length, '一个弹窗顶栏都没找到，这条门禁多半跑在空集上').toBeGreaterThan(20)
    expect(
      usages.some((usage) => usage.part === 'DialogHeader'),
      '没认出顶栏',
    ).toBe(true)
    expect(
      usages.some((usage) => usage.part === 'DialogTitle'),
      '没认出标题',
    ).toBe(true)

    // 认得出字号，认不出颜色。
    expect(sizesIn('text-lg font-semibold text-foreground'), '认不出字号').toEqual(['text-lg'])
    expect(sizesIn('text-foreground truncate'), '把一个颜色类当成了字号').toEqual([])
    // 认得出对齐，分得出变体。
    expect(alignmentsIn('text-center sm:text-left'), '认不出对齐').toEqual(['text-center', 'sm:text-left'])
    expect(alignmentsIn('text-left'), '认不出对齐').toEqual(['text-left'])
    // 认得出分隔线。
    expect(rulesIn('border-b flex flex-row'), '认不出分隔线').toEqual(['border-b'])
  })

  it('窄屏上不再把标题居中', () => {
    // 手机不是旧的设计：同一块顶栏，在两块屏幕上应该是同一副。它写的是
    // `text-center sm:text-left`——手机上居中，桌面上不居中。
    for (const rel of SHARED_DIALOG_PARTS) {
      const shared = sharedClassOf('DialogHeader')
      expect(shared, `${rel} 里认不出共享的顶栏`).not.toBe('')
    }

    const shared = sharedClassOf('DialogHeader')
    expect(
      alignmentsIn(shared).filter((alignment) => alignment !== 'text-left'),
      [
        '共享的顶栏在某一块屏幕上换了对齐：',
        ...alignmentsIn(shared),
        '顶栏在每一块屏幕上都是左对齐。',
      ].join('\n'),
    ).toEqual([])

    expect(
      hasUtility(shared, 'text-left'),
      '共享的顶栏没有写明左对齐',
    ).toBe(true)
  })

  it('弹窗的标题只有一档字号', () => {
    // 标题的字号是共享的那一档，调用点不自己改。
    // `OpenCodeConfigEditor` 写过 `text-lg font-semibold sm:text-xl`——
    // 手机上 18px、桌面上 20px，手机版反而更小。
    const shared = sharedClassOf('DialogTitle')
    expect(sizesIn(shared), '共享的标题没有写明字号').toEqual([DIALOG_TITLE_SIZE])

    const offenders = usages
      .filter((usage) => usage.part === 'DialogTitle' || usage.part === 'DialogTitleBar')
      .filter((usage) => sizesIn(usage.titleClasses).length > 0)

    expect(
      offenders.map((usage) => `${usage.rel}: ${sizesIn(usage.titleClasses).join(' ')}`),
      [
        `这些弹窗自己改了标题的字号：${offenders.length} 处`,
        ...offenders.map((usage) => `${usage.rel}: ${sizesIn(usage.titleClasses).join(' ')}`),
        `弹窗的标题一律用 ${DIALOG_TITLE_SIZE}（18px）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('顶栏的形状由共享的组件画', () => {
    // 调用点可以带一格内边距（整屏的弹窗在窄屏上没有内边距），
    // 但对齐和分隔线是共享组件的事——那两样一改，窄屏上和桌面上就不是
    // 同一副了。标题自己留的那一点空白（`pr-8`，给右上角的关闭按钮让位）
    // 不算顶栏的内边距。
    const offenders: string[] = []
    for (const usage of usages) {
      const alignments = alignmentsIn(usage.titleClasses).concat(
        alignmentsIn(usage.headerClasses),
      )
      const rules = rulesIn(usage.titleClasses).concat(rulesIn(usage.headerClasses))
      if (alignments.length > 0 || rules.length > 0) {
        offenders.push(`${usage.rel}: ${[...alignments, ...rules].join(' ')}`)
        continue
      }
      const padding = usage.headerClasses
        .split(/\s+/)
        .filter((token) => /^(?:[a-z]+:)*p[trblxy]?-/.test(utilityOf(token)))
      if (padding.length === 0) continue
      if (!OWN_PADDING.some(([rel]) => rel === usage.rel)) {
        offenders.push(`${usage.rel}: 自己写了内边距 ${padding.join(' ')}`)
      }
    }

    expect(
      offenders,
      [
        `这些弹窗自己写了顶栏的样子：${offenders.length} 处`,
        ...offenders,
        '对齐、分隔线和字号是共享组件的事；内边距只有整屏的弹窗能自己带，',
        '而且要写进例外名单。',
      ].join('\n'),
    ).toEqual([])
  })

  it('标题和说明之间只有一档距离', () => {
    // 标题和它下面那一行之间的距离，由**那一行**自己决定（`DialogDescription`
    // 的上边距）。以前是顶栏的 `space-y-1.5` 管着普通那套，
    // `DialogTitleBar` 那一套则一点距离都没有——说明紧贴着标题。
    const description = sharedClassOf('DialogDescription')
    expect(description, '共享的说明没有写明自己离标题多远').toMatch(/\bmt-[\d.]+\b/)

    expect(
      sharedClassOf('DialogHeader'),
      '共享的顶栏不该用 space-y 排它的孩子：距离是说明自己的事',
    ).not.toMatch(/\bspace-y-/)

    const bar = bodyOf(sourceOf('components/ui/dialog-layout.tsx'), 'DialogTitleBar')
    expect(bar, '认不出 DialogTitleBar').not.toBe('')
    expect(
      bar,
      'DialogTitleBar 的那一列不该用 space-y 排它的孩子：距离是说明自己的事',
    ).not.toMatch(/\bspace-y-/)
  })

  it('例外都写明了为什么', () => {
    for (const [rel, reason] of OWN_PADDING) {
      expect(reason.trim().length, `${rel} 没有写为什么可以自己带内边距`).toBeGreaterThan(0)
      expect(
        SOURCES.some((source) => source.rel === rel),
        `例外里的 ${rel} 不存在了，这条该删`,
      ).toBe(true)
    }
  })
})
