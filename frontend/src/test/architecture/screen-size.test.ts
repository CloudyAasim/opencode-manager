import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments, stringLiterals, classListOfTag } from './source-text'

/**
 * 屏幕之间没有第二副字。
 *
 * 三十一处字在手机上比在桌面上小：卡片的名字、卡片下面的说明、输入框旁边的
 * 标签、选项卡的字、按钮上的字。它们全是同一个方向——手机更小——所以这不是
 * 一批取舍，是同一个毛病长了三十一次。
 *
 * 手机不是旧的设计（`mobile-plasma.test.ts` 的论点）：**同一句话在两块屏幕上
 * 一样大**。所以这一轮把换档的写法都去掉，让宽屏那一档留在原地。
 *
 * 顺带两件事：
 *
 * - 共享的 `CardTitle` 写着 `text-2xl`（24px），而**每一个**调用点都把它改小
 *   了——共享的那一档从来没有人看见过。现在它是 16px，于是这条梯级成立了：
 *   页面标题 20px、小节 18px、卡片的名字 16px、卡片的说明 14px。
 * - 登录/注册页的字段名是灰的（`text-muted-foreground`），而应用里的字段名是
 *   共享的 `Label` 那个样子。它们在应用外壳之外，但字段名是同一个零件。
 *
 * 判的是**形状**：这一段字在两块屏幕上是不是同一档、这一副卡片是不是共享的
 * 零件画的。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的零件。 */
const SHARED = {
  card: 'components/ui/card.tsx',
  label: 'components/ui/label.tsx',
  /** 共享的那些零件都在这个文件夹里。 */
  folder: 'components/ui/',
}

/** 一档字号是多少像素。 */
const SIZE_PX: Record<string, number> = {
  '2xs': 10,
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
}

const SIZE_NAME = '(2xs|xs|sm|base|lg|xl|2xl|3xl|4xl)'

/** 一个工具类去掉变体前缀之后的样子。 */
function utilityOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1]!
}

/** 一串类名里写的字号。 */
function sizesIn(list: string): string[] {
  return list
    .split(/\s+/)
    .map(utilityOf)
    .filter((token) => new RegExp(`^text-${SIZE_NAME}$`).test(token))
}

/**
 * 一串类名里，窄屏与宽屏各写了哪一档字号。
 *
 * 窄屏那一档是不带前缀的那个；宽屏那一档是 `sm:`（640px）之后的——应用自己
 * 的"桌面"从 768px 开始，而 `sm:` 是 Tailwind 的那一档，两者相差不远。
 */
function screensIn(list: string): { narrow: string | null; wide: string | null } {
  let narrow: string | null = null
  let wide: string | null = null
  for (const token of list.split(/\s+/)) {
    const size = new RegExp(`^text-${SIZE_NAME}$`).exec(utilityOf(token))
    if (!size) continue
    if (token.includes(':')) {
      if (!wide) wide = size[1]!
    } else if (!narrow) {
      narrow = size[1]!
    }
  }
  return { narrow, wide }
}

/**
 * 这一串类名里的字，在两块屏幕上是不是不一样大。
 *
 * 窄屏那一档是不带前缀的那个；宽屏那一档是 `sm:`（640px）之后的——应用自己
 * 的"桌面"从 768px 开始，而 `sm:` 是 Tailwind 的那一档，两者相差不远。
 */
function differsByScreen(list: string): boolean {
  const { narrow, wide } = screensIn(list)
  if (!narrow || !wide) return false
  return SIZE_PX[narrow] !== SIZE_PX[wide]
}

/** 全树里所有像类名的字符串。 */
function classLists(): Array<{ rel: string; list: string }> {
  const found: Array<{ rel: string; list: string }> = []
  for (const source of SOURCES) {
    for (const literal of stringLiterals(source.text)) {
      if (!/\btext-(?:2xs|xs|sm|base|lg|xl|2xl|3xl|4xl)\b/.test(literal)) continue
      found.push({ rel: source.rel, list: literal })
    }
  }
  return found
}

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

/**
 * 共享组件自己写的那一串类名。
 *
 * 共享的零件是函数（`const CardTitle = React.forwardRef(...)`），所以它的类名
 * 不在一个标签上——它在那个函数自己的 `cn(...)` 里。
 */
function sharedClassOf(rel: string, name: string): string {
  const text = sourceOf(rel)
  const declaration = new RegExp(`(?:function|const)\\s+${name}\\b`).exec(text)
  if (!declaration) return ''
  const body = text.slice(declaration.index, declaration.index + 1200)
  const single = /cn\(\s*'([^']*)'/.exec(body)?.[1]
  const double = /cn\(\s*"([^"]*)"/.exec(body)?.[1]
  return (single ?? double ?? '').replace(/\s+/g, ' ').trim()
}

describe('屏幕之间没有第二副字', () => {
  it('门禁自己看得见东西', () => {
    // 一道扫不到东西的门禁永远是绿的，一道认不出形状的门禁判的是别的事。
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    const lists = classLists()
    expect(lists.length, '一处像类名的字符串都没找到，这条门禁多半跑在空集上').toBeGreaterThan(50)

    // 认得出两档，认得出哪一档更小。
    expect(screensIn('text-xs sm:text-sm'), '认不出两块屏幕上的两档').toEqual({
      narrow: 'xs',
      wide: 'sm',
    })
    expect(screensIn('text-sm'), '认不出只有一档的情况').toEqual({ narrow: 'sm', wide: null })
    expect(screensIn('text-foreground'), '把一个颜色类当成了字号').toEqual({ narrow: null, wide: null })

    // 而且认得出"这两档不一样大"——不然这道门禁可能只是瞎着。
    expect(differsByScreen('text-xs sm:text-sm'), '认不出两档不一样大').toBe(true)
    expect(differsByScreen('text-sm sm:text-sm'), '把两档一样大的当成了不一样大').toBe(false)
    expect(differsByScreen('text-sm'), '只有一档的时候不该算不一样大').toBe(false)
  })

  it('同一段字在两块屏幕上一样大', () => {
    // 手机比桌面小——那是旧的设计。这个仓库里三十一处都是这个方向，
    // 所以它不是一批取舍，是同一个毛病。
    const offenders: string[] = []
    for (const { rel, list } of classLists()) {
      if (!differsByScreen(list)) continue
      offenders.push(`${rel}  ${list.slice(0, 70)}`)
    }

    expect(
      offenders,
      [
        `这些字在手机上和桌面上不一样大：${offenders.length} 处`,
        ...offenders,
        '同一句话在两块屏幕上一样大——手机不是旧的设计。',
      ].join('\n'),
    ).toEqual([])
  })

  it('卡片的名字与说明由共享的卡片组件决定', () => {
    // 共享的 `CardTitle` 写着 24px，而每一个调用点都把它改小了——共享的那一
    // 档从来没有人看见过。现在它是 16px，梯级也就成立了：
    // 页面 20px、小节 18px、卡片 16px、卡片的说明 14px。
    const card = sourceOf(SHARED.card)
    const title = sharedClassOf(SHARED.card, 'CardTitle')
    const description = sharedClassOf(SHARED.card, 'CardDescription')
    void card

    expect(sizesIn(title), '共享的卡片名字没有写明字号').toEqual(['text-base'])
    expect(sizesIn(description), '共享的卡片说明没有写明字号').toEqual(['text-sm'])

    // 调用点不改它的大小。
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (source.rel === SHARED.card) continue
      for (const list of classListOfTag(source.text, 'CardTitle')) {
        const sizes = sizesIn(list)
        if (sizes.length === 0) continue
        if (sizes.every((size) => size === 'text-base')) continue
        offenders.push(`${source.rel}  ${list.slice(0, 70)}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方改了共享卡片名字的字号：${offenders.length} 处`,
        ...offenders,
        '卡片的名字是 16px，由共享的卡片组件说了算。',
      ].join('\n'),
    ).toEqual([])
  })

  it('字段的名字是共享的那个样子', () => {
    // 登录/注册页的字段名是灰的，应用里的不是。它们在应用外壳之外，但字段名
    // 是同一个零件——同一个零件就不该有两种颜色。
    //
    // 共享的那些零件可以自己拼装它：表单的字段名出错的时候变红（`FormLabel`
    // 里那一句 `error && "text-destructive"`）是**状态**，不是另一副样子，而且
    // 它写在共享的零件里，只有一处。零件之外的地方就没有这种自由了。
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (source.rel === SHARED.label) continue
      if (source.rel.startsWith(SHARED.folder)) continue
      for (const list of classListOfTag(source.text, 'Label')) {
        const colours = list
          .split(/\s+/)
          .filter((token) => /^text-(?!xs\b|sm\b|base\b|lg\b|xl\b|2xl\b|foreground$)/.test(token))
          .map(utilityOf)
        if (colours.length === 0) continue
        offenders.push(`${source.rel}  ${list.slice(0, 70)}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方改了共享字段名的颜色：${offenders.length} 处`,
        ...offenders,
        '字段名的样子是共享那个 Label 说了算：外壳之外也是同一副。',
      ].join('\n'),
    ).toEqual([])
  })
})
