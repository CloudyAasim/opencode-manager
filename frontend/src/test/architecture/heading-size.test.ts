import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * 标题的刻度。
 *
 * 上一轮把"页面叫什么名字"定了下来：共享的 `Header` 说，全站一档字号
 * （20px）。这一轮往下走一层——**页面里面的节**也该有一档字号，而卡片里的
 * 标题不该比卡片本身还大。
 *
 * 调查过的事实：
 *
 * - `<h2>` 有 15 处，分布在 18px/16px/14px 三档；
 * - `<h3>` 有 14 处，分布在 16px/14px/12px/20px 四档，还有两处**没写字号**；
 * - `<h4>` 有 9 处，其中七处把字号写在一个共享常量里（门禁得看得见常量里
 *   那个值），两处干脆没写；
 * - `<h5>` 有一处——警告条的头——也没写字号。
 *
 * 所以规则是：
 *
 * - **小节标题是 `<h2>`，一律 18px**（`text-lg`），和 `SectionHeader` 一样；
 * - **卡片里的标题（`<h3>`/`<h4>`/`<h5>`）要写明字号，而且不超过 16px**：
 *   卡片的名字和卡片里的标签各有各的档，但没有一个比卡片本身还大；
 * - **不是小节的东西不戴标题的帽子**：路径的根、抽屉里的仓库名，那是标签，
 *   不是标题。
 *
 * 判的是**形状**：这个标题画的是哪一个标签、它写了哪一档字号。字号写在
 * 类名里还是写在一个共享常量里，门禁都看得见——常量就在同一个文件里。
 *
 * 页面标题（`<h1>`）那一级在 `page-title.test.ts` 里：它有主人，也有例外
 * 名单。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/**
 * Tailwind 的字号刻度，外加这个仓库自己加的一级微字号。
 */
const SIZE_NAMES = [
  '2xs',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
]

/** 一档字号是多少像素。 */
const SIZE_PX: Record<string, number> = {
  'text-2xs': 10,
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
  'text-4xl': 36,
}

/** 小节标题那一档字号：和 `SectionHeader` 一样。 */
const SECTION_SIZE = 'text-lg'

/** 卡片里的标题最大能有多大——不能比卡片本身还大。 */
const CARD_CEILING_PX = 16

interface Heading {
  rel: string
  level: number
  sizes: string[]
}

/**
 * 一个类名里的字号工具类。
 *
 * 认的是"这个工具类是一档字号"：颜色类（`text-foreground`）不在这个名单里，
 * 所以一个只写了颜色的标题会被认成"没有写字号"，而不是被认成某一档。
 */
function sizesIn(list: string): string[] {
  return list
    .split(/\s+/)
    .filter((token) => SIZE_NAMES.some((name) => token === `text-${name}`))
}

/**
 * 从 `<h2` 到那个 `>`。
 *
 * 引号里的 `>` 不算：类名里可以有 `[&>svg]` 这样的选择器，用第一个 `>`
 * 收尾会在半个类名上停下。
 */
function headingTagAt(text: string, start: number): string {
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
 * 一个标题的类名。
 *
 * 三种写法都算数：写在 `className="..."` 里；写在 `className={cn('...', '...')}`
 * 里；写在 `className={SOME_CONSTANT}` 里——常量在同一个文件里，门禁把它
 * 找出来，那一档字号就还在。
 */
function classListOf(attrs: string, fileText: string): string {
  const literal = /className="([^"]*)"/.exec(attrs)
  if (literal) return literal[1]!

  const expression = /className=\{([^}]*)\}/.exec(attrs)
  if (!expression) return ''

  const body = expression[1]!.trim()
  if (/^[A-Za-z_$][\w$]*$/.test(body)) {
    const definition = new RegExp(
      `(?:const|let)\\s+${body}\\s*=\\s*['"\`]([^'"\`]*)['"\`]`,
    ).exec(fileText)
    return definition?.[1] ?? ''
  }

  return [...body.matchAll(/'([^']*)'|"([^"]*)"/g)]
    .map((match) => match[1] ?? match[2] ?? '')
    .join(' ')
}

/** 全站的标题，带着它们各自写的字号。 */
function everyHeading(): Heading[] {
  const found: Heading[] = []
  for (const source of SOURCES) {
    const matcher = /<h([1-6])\b/g
    let match: RegExpExecArray | null
    while ((match = matcher.exec(source.text)) !== null) {
      const tag = headingTagAt(source.text, match.index)
      const attrs = tag.slice(match[0].length, tag.endsWith('>') ? -1 : undefined)
      found.push({
        rel: source.rel,
        level: Number(match[1]),
        sizes: sizesIn(classListOf(attrs, source.text)),
      })
    }
  }
  return found
}

const headings = everyHeading()

const ofLevel = (level: number): Heading[] => headings.filter((heading) => heading.level === level)

const describe_ = (heading: Heading): string =>
  `${heading.rel}: ${heading.sizes.join(' ') || '没写字号'}`

describe('标题的刻度', () => {
  it('门禁自己看得见东西', () => {
    // 一道扫不到东西的门禁永远是绿的，一道认不出形状的门禁判的是别的事。
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    expect(headings.length, '一个标题都没找到，这条门禁多半跑在空集上').toBeGreaterThan(20)
    expect(ofLevel(2).length, '没认出小节标题').toBeGreaterThan(5)
    expect(ofLevel(3).length, '没认出卡片里的标题').toBeGreaterThan(5)

    // 认得出字号，认不出颜色，认得出"没写"。
    expect(sizesIn('text-lg font-semibold text-foreground'), '认不出字号').toEqual(['text-lg'])
    expect(sizesIn('text-foreground truncate'), '把一个颜色类当成了字号').toEqual([])
    expect(sizesIn('font-semibold truncate'), '没写的字号被认成了某一档').toEqual([])

    // 字号写在共享常量里，也算数——常量就在同一个文件里。
    expect(
      classListOf(
        ' className={SECTION_TITLE_CLASS}',
        "const SECTION_TITLE_CLASS = 'text-sm font-medium truncate'",
      ),
      '看不见常量里的字号',
    ).toBe('text-sm font-medium truncate')
    expect(
      classListOf(' className={cn("text-base", "font-semibold")}', ''),
      '看不见表达式里的字号',
    ).toBe('text-base font-semibold')
  })

  it('小节标题只有一档字号', () => {
    // 一节就是一节。上一轮把页面标题的字号定了下来，这一节往下走一层：
    // 页面里面的节也是一档字号，而且就是 `SectionHeader` 用的那一档。
    const offenders = ofLevel(2).filter(
      (heading) => heading.sizes.length !== 1 || heading.sizes[0] !== SECTION_SIZE,
    )

    expect(
      offenders.map(describe_),
      [
        `这些小节标题不是那一档字号：${offenders.length} 处`,
        ...offenders.map(describe_),
        `小节标题一律用 ${SECTION_SIZE}（18px）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('卡片里的标题不会比卡片还大', () => {
    // 卡片的名字和卡片里的标签各有各的档——16px、14px、12px 都行——但它们
    // 都是**卡片里面**的东西，不能比卡片本身还大。20px 的标题出现在一张
    // 卡片里，读起来像是这一页的标题。
    const offenders = ofLevel(3)
      .concat(ofLevel(4))
      .concat(ofLevel(5))
      .filter((heading) => {
        if (heading.sizes.length !== 1) return true
        const px = SIZE_PX[heading.sizes[0]!]
        return px === undefined || px > CARD_CEILING_PX
      })

    expect(
      offenders.map(describe_),
      [
        `这些标题太大，或者没写明字号：${offenders.length} 处`,
        ...offenders.map(describe_),
        `卡片里的标题要写明字号，而且不超过 ${CARD_CEILING_PX}px。`,
      ].join('\n'),
    ).toEqual([])
  })
})
