import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * 页面标题只有一副，也只有一档字号。
 *
 * 一个页面说清自己是什么，只有一个地方可以说：共享的 `Header`。终端页上一轮
 * 用的是 `SectionHeader`——那是**一节**的标题，被拿来当了页面标题：字号小一
 * 档，它属于页面里面的一节，不属于这一页。同一句话于是有了两种画法。
 *
 * 所以这里有三条线：
 *
 * - **页面标题**是 `<h1>`，由共享的 `Header` 画；
 * - **小节标题**是 `<h2>`，由 `SectionHeader` 画，而且它只能是 `<h2>`——
 *   没有开关能把它变成页面标题；
 * - **页面标题只有一档字号**：20px，Tailwind 的 `text-xl`。
 *
 * 第三条是这一轮补上的。上一轮把"谁来说页面的名字"统一了，字号却还散在四
 * 个地方：仓库页、终端页、计划页是 20px，会话页 16px，文件页 14px，设置页
 * 桌面 18px 而手机 20px——同一个词"Settings"在两种屏幕上两个尺寸。名字是一
 * 个名字，不该有两个大小。
 *
 * 判的是**形状**，不是见过的字符串：判的是"这个组件画的是哪一个标题标签"、
 * "这个组件有没有那个能力"、"这个页面拿哪个组件说自己的名字"，以及"这一档
 * 字号是不是全站只有一个"。组件改了名、换了写法，这条规则照样成立。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 页面标题的主人：共享的标题栏。 */
const PAGE_TITLE_OWNER = 'components/ui/header.tsx'

/** 小节标题：页面**里面**的一节。 */
const SECTION_TITLE_OWNER = 'components/ui/section-header.tsx'

/**
 * 自己就是全部的页面。
 *
 * 这些屏幕在应用外壳之外——没有顶栏、没有状态栏，它们自己就是全部。标题
 * 因此只能由它们自己说，而它们用的也不是共享的 `Header`。
 */
const SELF_CONTAINED_SCREENS: ReadonlyArray<readonly [string, string]> = [
  ['pages/Login.tsx', '登录页在应用外壳之外：它自己就是全部'],
  ['pages/Register.tsx', '同上'],
  ['pages/Setup.tsx', '初始化页在应用外壳之外：它自己就是全部'],
  ['components/ui/error-boundary.tsx', '错误页没有标题栏：它自己就是全部'],
  ['components/ui/route-error-boundary.tsx', '同上'],
]

/**
 * 页面标题那一档字号。
 *
 * Tailwind 的 `text-xl` 是 20px。它是这一档字号的**名字**，而门禁认的是
 * "这个工具类是一档字号"：颜色类（`text-foreground`、`text-muted-foreground`）
 * 不在下面的名单里，所以一个只写了颜色的标题会被认成"没有写字号"，而不是
 * 被认成某一档。
 */
const PAGE_TITLE_SIZE = 'text-xl'

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
  'text-5xl',
  'text-6xl',
  'text-7xl',
  'text-8xl',
  'text-9xl',
]

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

/**
 * 路由页面。
 *
 * 名单是从路由表里读出来的，不是照着目录列的——路由表说哪个模块是一个页面，
 * 它就是。目录里多一个文件不算，路由表少一个也不算。
 */
const routePages = (): string[] => {
  const routes = graph.files.find((file) => relativeTo(graph, file) === 'routes.tsx')
  if (!routes) return []
  const pages = graph.edges
    .filter((edge) => edge.from === routes)
    .map((edge) => relativeTo(graph, edge.to))
    .filter((rel) => rel.startsWith('pages/'))
  return [...new Set(pages)].sort()
}

/**
 * 组件画出来的标题标签。
 *
 * 只认写死在标记里的标签：`<h2`。一个用变量挑出来的标题（`const Heading =
 * level === 1 ? 'h1' : 'h2'`）在这里看不见——所以下面还有一条规则，直接要求
 * 小节标题的标签是写下来的。
 */
const HEADING_TAG = /<h([1-6])\b/g

function headingTags(text: string): string[] {
  return [...text.matchAll(HEADING_TAG)].map((match) => match[1]!)
}

/**
 * 一个函数自己的那一段。
 *
 * 共享的标题栏有两个画标题的写法——一个普通的，一个可以改的。它们各自都该
 * 画一个 `<h1>`，而"这个文件里有 `<h1>`"这句话太粗：改掉其中一个，另一个
 * 还在，于是门禁看不见。所以判到函数这一层。
 */
function bodyOf(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const rest = text.slice(start + 1)
  const next = rest.search(/\n(?:function|interface|const|export)\s/)
  return next === -1 ? rest : rest.slice(0, next)
}

/** 这个文件是否导入了那个模块（类型导入不算）。 */
function imports(rel: string, target: string): boolean {
  const file = graph.files.find((candidate) => relativeTo(graph, candidate) === rel)
  if (!file) return false
  return graph.edges.some(
    (edge) =>
      edge.from === file && !edge.typeOnly && relativeTo(graph, edge.to) === target,
  )
}

/**
 * 一个 `<h1>` 标签写的 class。
 *
 * 标签里的引号内容都算：写在 `className="..."` 里的，和写在
 * `className={cn('...', '...')}` 里的，是同一件事。字号工具类从这些词里挑，
 * 挑不出来就是"这个标题没有写字号"。
 */
const H1_TAG = /<h1\b[^>]*>/g

function h1Sizes(text: string): string[][] {
  return [...text.matchAll(H1_TAG)].map((match) => {
    const literals = [...(match[0] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)].map(
      (literal) => literal[1] ?? literal[2] ?? '',
    )
    const tokens = literals.flatMap((literal) => literal.split(/\s+/))
    return tokens.filter((token) => SIZE_CLASSES.includes(token))
  })
}

/** 全站所有的页面标题，带着它们各自写的字号。 */
function everyPageTitle(): Array<{ rel: string; sizes: string[] }> {
  const found: Array<{ rel: string; sizes: string[] }> = []
  for (const source of SOURCES) {
    for (const sizes of h1Sizes(source.text)) {
      found.push({ rel: source.rel, sizes })
    }
  }
  return found
}

describe('页面标题只有一副', () => {
  it('门禁自己看得见东西', () => {
    // 一道扫不到东西的门禁永远是绿的，一道认不出形状的门禁判的是别的事。
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    expect(routePages().length, '没有路由页面，这条门禁读错了地方').toBeGreaterThan(5)

    expect(headingTags('<h1 className="text-xl">x</h1>'), '认不出页面标题').toEqual(['1'])
    expect(headingTags('<h2 className="text-lg">x</h2>'), '认不出小节标题').toEqual(['2'])
    expect(
      headingTags('<Heading className="text-lg">x</Heading>'),
      '把一个挑出来的标签当成了写死的标签',
    ).toEqual([])
  })

  it('门禁自己认得出字号', () => {
    // 认的是"这个工具类是一档字号"，不是"我见过这个字符串"。
    expect(h1Sizes('<h1 className="text-xl">x</h1>'), '认不出页面标题的字号').toEqual([['text-xl']])
    expect(h1Sizes('<h1 className="text-base">x</h1>'), '认不出另一档字号').toEqual([['text-base']])
    expect(
      h1Sizes('<h1 className="text-foreground">x</h1>'),
      '把一个颜色类当成了字号',
    ).toEqual([[]])
    expect(
      h1Sizes('<h1 className={cn("text-xl", "font-semibold")}>x</h1>'),
      '认不出写在表达式里的字号',
    ).toEqual([['text-xl']])
    expect(h1Sizes('<p className="text-xl">x</p>'), '把一个段落当成了标题').toEqual([])

    const titles = everyPageTitle()
    expect(titles.length, '一个页面标题都没找到，这条门禁多半跑在空集上').toBeGreaterThan(2)
    expect(
      titles.some((title) => title.rel === PAGE_TITLE_OWNER),
      '连共享的 Header 都没找到，这条门禁读错了地方',
    ).toBe(true)
  })

  it('共享的 Header 画的是页面标题', () => {
    // 页面标题是这一页的 `<h1>`，而它的主人是共享的标题栏。共享的标题栏有
    // 两个画标题的写法——一个普通的，一个可以改的——两个都得画 `<h1>`：少了
    // 一个，那个页面就没有标题了。
    const owner = sourceOf(PAGE_TITLE_OWNER)
    for (const variant of ['HeaderTitle', 'HeaderEditableTitle']) {
      const body = bodyOf(owner, variant)
      expect(body.length, `共享的 Header 里没有 ${variant} 这个写法了`).toBeGreaterThan(0)
      expect(
        headingTags(body),
        `${variant} 画的不是一个页面标题（<h1>）`,
      ).toContain('1')
    }
  })

  it('小节标题画不出页面标题', () => {
    // 这一条是本轮真正的修复：`SectionHeader` 曾经有一个 `level` 开关，能把
    // 自己变成 `<h1>`，于是终端页用它当了页面标题。现在它只能是 `<h2>`，
    // 而且标签是写死在标记里的——用变量挑出来的那种写法在这里看不见。
    const owner = sourceOf(SECTION_TITLE_OWNER)
    const tags = headingTags(owner)

    expect(
      tags,
      [
        `小节标题画的标签不对：${tags.join(', ') || '一个也没有'}`,
        '小节标题只能是 <h2>：它是页面里面的一节，不是这一页。',
      ].join('\n'),
    ).toEqual(['2'])

    expect(
      /h1/.test(owner),
      '小节标题里还有 h1 的影子——它随时能变回页面标题',
    ).toBe(false)
  })

  it('路由页面不拿小节标题当自己的标题', () => {
    // 形状上的判据：这个页面导入了画 `<h2>` 的那个组件，就是在用一节的标题
    // 说这一页是谁。组件改名、换写法，这条规则照样成立。
    const offenders = routePages().filter((rel) => imports(rel, SECTION_TITLE_OWNER))
    expect(
      offenders,
      [
        `这些页面拿小节标题当页面标题：${offenders.length} 处`,
        ...offenders,
        '页面自己的标题用共享的 <Header>；页面里面的一节用 <SectionHeader>。',
      ].join('\n'),
    ).toEqual([])
  })

  it('路由页面不自己写页面标题', () => {
    // 页面标题是 `<h1>`，而它由共享的 `Header` 画。所以路由页面自己不该有
    // 一个 `<h1>`——自己写一个，就是又有了第二种画法。
    const offenders = routePages().filter((rel) => {
      if (SELF_CONTAINED_SCREENS.some(([page]) => page === rel)) return false
      return headingTags(sourceOf(rel)).includes('1')
    })

    expect(
      offenders,
      [
        `这些页面自己写了页面标题：${offenders.length} 处`,
        ...offenders,
        '页面标题交给共享的 <Header>；页面里面的一节用 <SectionHeader>。',
      ].join('\n'),
    ).toEqual([])
  })

  it('只有共享的 Header 能写页面标题', () => {
    // 上一条只管路由页面。可页面标题也会长在别的地方——一个组件、一个小节、
    // 一个抽屉。标题是这一页的名字，而名字由共享的 `Header` 说；别处再写一
    // 个 `<h1>`，就是又有了第二种画法：同样的字，两副骨架。
    const offenders = SOURCES.filter((source) => {
      if (source.rel === PAGE_TITLE_OWNER) return false
      if (SELF_CONTAINED_SCREENS.some(([rel]) => rel === source.rel)) return false
      return h1Sizes(source.text).length > 0
    })

    expect(
      offenders.map((source) => source.rel),
      [
        `这些地方自己写了页面标题：${offenders.length} 处`,
        ...offenders.map((source) => source.rel),
        '页面标题交给共享的 <Header>；页面里面的一节用 <SectionHeader>。',
      ].join('\n'),
    ).toEqual([])
  })

  it('页面标题只有一档字号', () => {
    // 一个名字只有一个大小。这一条抓的是"同一个词两种尺寸"：设置页的
    // "Settings"桌面 18px、手机 20px，文件页的"Files"14px，会话页的标题
    // 16px——它们都是页面的名字。
    const titles = everyPageTitle()
    expect(titles.length, '一个页面标题都没找到，这条门禁多半跑在空集上').toBeGreaterThan(2)

    const offenders = titles.filter(
      (title) => title.sizes.length !== 1 || title.sizes[0] !== PAGE_TITLE_SIZE,
    )

    expect(
      offenders.map((title) => `${title.rel}: ${title.sizes.join(' ') || '没写字号'}`),
      [
        `这些页面标题不是那一档字号：${offenders.length} 处`,
        ...offenders.map((title) => `${title.rel}: ${title.sizes.join(' ') || '没写字号'}`),
        `页面标题一律用 ${PAGE_TITLE_SIZE}，而且只写一档。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('共享的 Header 里那两个写法是同一档字号', () => {
    // 一个普通的标题，一个可以改的标题。它们是同一个东西的两种写法，字号
    // 必须一样——不然"点一下开始改名"这件事，就把名字换了个大小。
    const owner = sourceOf(PAGE_TITLE_OWNER)
    const titles = h1Sizes(owner)
    expect(titles.length, '共享的 Header 里没有页面标题了').toBeGreaterThan(1)

    for (const sizes of titles) {
      expect(sizes, '共享的 Header 里的标题没有写清字号').toEqual([PAGE_TITLE_SIZE])
    }
  })

  it('例外都写明了为什么', () => {
    for (const [rel, reason] of SELF_CONTAINED_SCREENS) {
      expect(reason.trim().length, `${rel} 没有写为什么可以不算`).toBeGreaterThan(0)
      expect(
        SOURCES.some((source) => source.rel === rel),
        `例外里的 ${rel} 不存在了，这条该删`,
      ).toBe(true)
    }
  })
})
