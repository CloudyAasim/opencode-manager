import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfTag, firstClassListOf, stripComments } from './source-text'

/**
 * 共享零件的字号，只有共享那一份说了算。
 *
 * 每个共享零件都自己带着字——按钮上的字、徽章上的字、选项卡上的字、字段名的
 * 字、菜单项的字。它们各自在刻度上占一档：徽章 12px，按钮/选项卡/字段名/菜单项
 * 14px，卡片的名字 16px，小节 18px。
 *
 * 但七十四处调用点把这件事又写了一遍：按钮被改成 12px 和 16px，徽章被改成
 * 10px，字段名被改成 12px 和 16px。于是同一个零件在不同的地方是不同的大小，
 * 而**它自己那一档从来没有人看见过**。
 *
 * 更怪的是按钮：`size="sm"` 只改高度不改字，于是"小按钮"是 32px 高配 14px 的
 * 字，而被改小过字的那个按钮是 36px 高配 12px 的字——**尺寸和字是交叉的**。
 *
 * 所以这一轮：
 *
 * - 共享的零件自己写明它那一档字号，调用点不再写。
 * - 需要另一档的，用零件自己给的办法（`size="sm"`），不用类名。
 *
 * 判的是**形状**：一个零件自己带不带字、它自己那一档是多少、调用点有没有又
 * 写了一次。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那些零件都在这个文件夹里。 */
const SHARED_FOLDER = 'components/ui/'

/**
 * 全应用都在用的那几件零件：它们那一档写死在共享零件里。
 *
 * 这一条是"只有一副"的另一半——不光是调用点不重复写，共享零件自己也必须写
 * 明了它是哪一档。否则有人把按钮的 `text-sm` 删了，按钮上的字就跟着外面那
 * 一档变，而没有人会知道按钮变成了几号字。
 */
const FIXED_SIZES: Array<{ rel: string; name: string; size: string }> = [
  { rel: 'components/ui/button.tsx', name: 'Button', size: 'text-sm' },
  { rel: 'components/ui/badge.tsx', name: 'Badge', size: 'text-xs' },
  { rel: 'components/ui/tabs.tsx', name: 'TabsTrigger', size: 'text-sm' },
  { rel: 'components/ui/label.tsx', name: 'Label', size: 'text-sm' },
  { rel: 'components/ui/dropdown-menu.tsx', name: 'DropdownMenuItem', size: 'text-sm' },
]

/** Tailwind 自己那一档字号是多少像素。 */
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

const BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl'])

/** 一串类名里写的字号。 */
function sizesIn(list: string): Array<{ token: string; size: string; breakpoint: string | null }> {
  const found: Array<{ token: string; size: string; breakpoint: string | null }> = []
  for (const token of list.split(/\s+/)) {
    const match = /^(?:([a-z0-9-]+):)?text-(2xs|xs|sm|base|lg|xl|2xl|3xl|4xl)$/.exec(token)
    if (!match) continue
    const variant = match[1] ?? null
    // `file:text-sm`（文件按钮）、`hover:text-sm`（一个状态）说的是别的东西。
    if (variant && !BREAKPOINTS.has(variant)) continue
    found.push({ token, size: match[2]!, breakpoint: variant })
  }
  return found
}

interface Part {
  name: string
  rel: string
  /** 它那一段代码。 */
  body: string
  /** 它所在的那份文件。 */
  module: string
}

/**
 * 一个常量在这份文件里的值。
 *
 * 有两种写法：直接是一串字（`const SURFACE_CLASS = '…'`），或者是包着它的
 * 那个调用（`const buttonVariants = cva('…', {…})`）。两种都要找得到——按钮的
 * 字号就写在第二种里面。
 */
function constValue(text: string, identifier: string): string | undefined {
  const match = new RegExp(`\\bconst\\s+${identifier}\\s*=`).exec(text)
  if (!match) return undefined
  const rest = text.slice(match.index + match[0].length)

  const quoted = /^\s*(['"`])([\s\S]*?)\1/.exec(rest)
  if (quoted) return quoted[2]

  const open = rest.indexOf('(')
  if (open < 0) return undefined
  let depth = 0
  let end = open
  for (; end < rest.length; end += 1) {
    if (rest[end] === '(') depth += 1
    else if (rest[end] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const first = /(['"`])([\s\S]*?)\1/.exec(rest.slice(open + 1, end))
  return first?.[2]
}

/** 共享的零件：`components/ui` 里导出的组件。 */
function partsOf(): Part[] {
  const parts: Part[] = []
  for (const source of SOURCES) {
    if (!source.rel.startsWith(SHARED_FOLDER)) continue
    if (!source.rel.endsWith('.tsx')) continue

    const names = new Set<string>()
    for (const match of source.text.matchAll(/export\s+(?:const|function)\s+([A-Z][\w$]*)/g)) {
      names.add(match[1]!)
    }
    for (const match of source.text.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const piece of match[1]!.split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && /^[A-Z]/.test(name)) names.add(name)
      }
    }

    for (const name of names) {
      const declaration = new RegExp(`(?:export\\s+)?(?:const|function)\\s+${name}\\b`).exec(source.text)
      if (!declaration) continue
      const rest = source.text.slice(declaration.index)
      // 下一个**顶层**的声明。函数里面写的 `const Comp = …` 不是顶层——
      // 拿它当界，零件的那一段代码就被截断在它自己身上了。
      const next = /\n(?:export\s+)?(?:const|function)\s+[A-Z]/.exec(rest.slice(1))
      parts.push({
        name,
        rel: source.rel,
        body: next ? rest.slice(0, next.index + 1) : rest,
        module: source.text,
      })
    }
  }
  return parts
}

/** 一段代码里画了哪些标签。 */
function tagsIn(body: string): string[] {
  const names = new Set<string>()
  for (const match of body.matchAll(/<([A-Za-z][\w.]*)\b/g)) names.add(match[1]!)
  return [...names]
}

/** 共享的零件自己带着字吗。 */
function carriesText(part: Part, parts: Map<string, Part>, seen: Set<string>): boolean {
  const resolve = (identifier: string): string | undefined => constValue(part.module, identifier)

  // 它自己画的那一串类名里写着字号——那就是它带着字。
  for (const tag of tagsIn(part.body)) {
    for (const list of classListOfTag(part.body, tag, resolve)) {
      if (sizesIn(list).length > 0) return true
    }
  }
  // 它画的是另一个带字的共享零件——那么字也是那个零件带来的。
  for (const tag of tagsIn(part.body)) {
    const nested = parts.get(tag)
    if (!nested || seen.has(tag)) continue
    if (carriesText(nested, parts, new Set([...seen, tag]))) return true
  }
  return false
}

const PARTS = partsOf()
const PART_BY_NAME = new Map(PARTS.map((part) => [part.name, part]))

const CARRYING = new Set(
  PARTS.filter((part) => carriesText(part, PART_BY_NAME, new Set([part.name]))).map(
    (part) => part.name,
  ),
)

/** 一个文件从共享的零件里引了什么。 */
function importsOf(rel: string, text: string): Map<string, string> {
  const map = new Map<string, string>()
  const matcher = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const target = resolveModule(rel, match[2]!)
    if (!target) continue
    for (const piece of match[1]!.split(',')) {
      const name = piece.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) map.set(name, target)
    }
  }
  return map
}

/** 一个 import 说明符指的是哪个文件。 */
function resolveModule(fromRel: string, spec: string): string | null {
  let base: string | null = null
  if (spec.startsWith('@/')) base = path.join(FRONTEND_SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.join(FRONTEND_SRC, path.dirname(fromRel), spec)
  if (!base) return null

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    const found = SOURCES.find((source) => source.rel === relativeTo(graph, path.normalize(candidate)))
    if (found) return found.rel
  }
  return null
}

interface CallSite {
  rel: string
  line: number
  part: Part
  list: string
}

/** 共享零件的调用点。 */
function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    const imported = importsOf(source.rel, source.text)
    for (const part of PARTS) {
      if (imported.get(part.name) !== part.rel) continue
      const matcher = new RegExp(`<${part.name}\\b`, 'g')
      const lists = classListOfTag(source.text, part.name)
      let index = 0
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          list: lists[index] ?? '',
        })
        index += 1
      }
    }
  }
  return found
}

const CALL_SITES = callSites()

describe('共享零件的字号只有共享那一份说了算', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到共享的零件。
    expect(PARTS.length, '一个共享的零件都没找到，这条门禁多半跑在空集上').toBeGreaterThan(40)
    for (const expected of ['Button', 'Badge', 'TabsTrigger', 'Label', 'DropdownMenuItem']) {
      expect([...PART_BY_NAME.keys()], `共享的零件 ${expected} 没被认出来`).toContain(expected)
    }

    // 认得出"自己带字"和"只是个壳"。
    expect(CARRYING.has('Button'), '按钮带着字，没被认出来').toBe(true)
    expect(CARRYING.has('Badge'), '徽章带着字，没被认出来').toBe(true)
    expect(CARRYING.has('Label'), '字段名带着字，没被认出来').toBe(true)
    // 表单的字段名是共享的 `Label` 画的——它也带着字。
    expect(CARRYING.has('FormLabel'), '表单的字段名带着字，没被认出来').toBe(true)
    // 卡片本身是个壳：它不画自己的字。
    expect(CARRYING.has('Card'), '把卡片这个壳当成了带字的零件').toBe(false)

    // 找得到调用点。
    expect(CALL_SITES.length, '一个共享零件的调用点都没找到').toBeGreaterThan(200)

    // 认得出字号，也认得出断点写的那一档。
    expect(sizesIn('text-sm'), '认不出 14px 那一档').toEqual([
      { token: 'text-sm', size: 'sm', breakpoint: null },
    ])
    expect(sizesIn('md:text-sm'), '认不出断点上写的那一档').toEqual([
      { token: 'md:text-sm', size: 'sm', breakpoint: 'md' },
    ])
    expect(sizesIn('text-foreground'), '把一个颜色类当成了字号').toEqual([])

    // 刻度上每一档是多少像素——不然"多大"这件事是空的。
    expect(SIZE_PX['2xs'], '认不出 10px 那一档').toBe(10)
    expect(SIZE_PX.sm, '认不出 14px 那一档').toBe(14)
    expect(SIZE_PX.base, '认不出 16px 那一档').toBe(16)
    expect(SIZE_PX.xl, '认不出 20px 那一档').toBe(20)
  })

  it('带字的共享零件自己写明了字号，而且不是断点写的那一档', () => {
    // 同一句话在两块屏幕上一样大（38 号那条）：共享零件自己也不该有"宽屏另一档"。
    const offenders: string[] = []
    for (const part of PARTS) {
      if (!CARRYING.has(part.name)) continue
      const resolve = (identifier: string): string | undefined => constValue(part.module, identifier)
      for (const tag of tagsIn(part.body)) {
        for (const list of classListOfTag(part.body, tag, resolve)) {
          for (const size of sizesIn(list)) {
            if (!size.breakpoint) continue
            offenders.push(`${part.rel}  ${part.name}  ${size.token}`)
          }
        }
      }
    }

    expect(
      offenders,
      [
        `这些共享零件在断点上又写了一档字号：${offenders.length} 处`,
        ...offenders,
        '同一句话在两块屏幕上一样大——共享零件也不例外。',
      ].join('\n'),
    ).toEqual([])
  })

  it('那几件到处都在用的零件，字号写死在共享零件里', () => {
    // 按钮上的字是 14px，徽章上是 12px，选项卡、字段名、菜单项是 14px。
    // 写死在共享零件里，调用点才有的可说。
    const offenders: string[] = []
    for (const fixed of FIXED_SIZES) {
      const part = PARTS.find((candidate) => candidate.rel === fixed.rel && candidate.name === fixed.name)
      expect(part, `找不到共享的零件 ${fixed.name}（${fixed.rel}）`).toBeDefined()
      const resolve = (identifier: string): string | undefined => constValue(part!.module, identifier)
      const list = firstClassListOf(part!.body, resolve)
      const sizes = sizesIn(list)
      if (sizes.length === 1 && sizes[0]!.token === fixed.size) continue
      offenders.push(
        `${fixed.rel}  ${fixed.name}  应该是 ${fixed.size}，现在是 ${
          sizes.map((size) => size.token).join(' + ') || '(没有)'
        }`,
      )
    }

    expect(
      offenders,
      [
        `这些共享零件没有写明自己那一档字号：${offenders.length} 处`,
        ...offenders,
        '那几件到处都在用的零件，字号写死在共享零件里。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不再写那一档字号', () => {
    // 共享的零件自己带着字，那一档字号就是它的事。调用点只写它没定的东西。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      if (!CARRYING.has(site.part.name)) continue
      const sizes = sizesIn(site.list)
      if (sizes.length === 0) continue
      offenders.push(
        `${site.rel}:${site.line}（${site.part.name}）  ${sizes.map((size) => size.token).join(' + ')}`,
      )
    }

    expect(
      offenders,
      [
        `这些地方又写了一次共享零件的字号：${offenders.length} 处`,
        ...offenders,
        '共享零件的字号由共享零件说了算：调用点只写它没定的东西。',
      ].join('\n'),
    ).toEqual([])
  })
})
