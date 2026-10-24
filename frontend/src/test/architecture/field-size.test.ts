import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfTag, constValue, firstClassListOf, stripComments, tagAt } from './source-text'

/**
 * 输入框里的字，由共享那一份说了算。
 *
 * 手机上聚焦一个不到 16px 的输入框，浏览器会自己放大，而且不缩回去。这条规矩
 * 有道理，所以它留下——但它应该只写在**一处**：`field-text`。
 *
 * 原来它写在了两处：
 *
 * - 样式表里一条全局的 `@media (max-width: 768px) { input, textarea, select
 *   { font-size: 16px !important } }`。这一条越权：它盖住了 `field-text`
 *   自己；它在 768px 那一格上还在（`max-width: 768px` 与 `width >= 768px` 都算
 *   768）；它对每一个输入框都算数，包括那些根本没打算用这条规矩的。
 * - 一堆类名里的 `md:text-sm`。它和 `field-text` 写的是同一件事（桌面上
 *   14px），于是同一档字号有了两个地方在写，而两处写的一样只是运气。
 *
 * 于是这一轮：
 *
 * - 全局那条删掉，规矩只留在 `field-text` 里。
 * - 共享的字段（`Input`、`Textarea`、下拉框的触发器）自己声明一次，调用点不再
 *   重复声明。
 * - 剩下的字段各说各的：**普通字段**用 `field-text`（手机 16px、桌面 14px）；
 *   **名字的字段**用名字自己的那一档（两屏一样大，而且不小于 16px）——名字在
 *   哪里是多大，编辑它的时候就是多大。
 *
 * 判的是**形状**：一个文本框的 class 表里有几档字号、那一档在手机上有多大、
 * 是不是断点写的、这条规矩是不是只有一处。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  file,
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const CSS = stripComments(fs.readFileSync(path.join(FRONTEND_SRC, 'index.css'), 'utf8'))

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

/** 断点。写在前缀上的字号只在这一档之后才生效。 */
const BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl'])

/** 手机上不到这个大小，浏览器就会自己放大。 */
const PHONE_FLOOR_PX = 16

/** 规矩的名字：共享的那一份。 */
const FIELD_TEXT = 'field-text'

/**
 * 一串类名里的字号。
 *
 * 有三种：
 *
 * - `field-text`——共享的那一份规矩（手机 16px、桌面 14px）。
 * - `text-base` 这样不带前缀的——这一档在两块屏幕上一样大。
 * - `md:text-sm` 这样带断点前缀的——这一档只在断点之后才生效。
 *
 * `file:text-sm`（文件按钮）、`hover:text-sm`（一个状态）说的是别的东西，
 * 不算这个输入框自己的字号。
 */
interface Declaration {
  token: string
  /** `field-text` 还是 Tailwind 自己的一档。 */
  shared: boolean
  /** Tailwind 那一档的名字。 */
  size: string | null
  /** 断点；没有就是两块屏幕都生效。 */
  breakpoint: string | null
}

function declarationsOf(list: string): Declaration[] {
  const found: Declaration[] = []
  for (const token of list.split(/\s+/)) {
    if (!token) continue
    if (token === FIELD_TEXT) {
      found.push({ token, shared: true, size: null, breakpoint: null })
      continue
    }
    const match = /^(?:([a-z0-9-]+):)?text-(2xs|xs|sm|base|lg|xl|2xl|3xl|4xl)$/.exec(token)
    if (!match) continue
    const variant = match[1] ?? null
    if (variant && !BREAKPOINTS.has(variant)) continue
    found.push({ token, shared: false, size: match[2]!, breakpoint: variant })
  }
  return found
}

/** 那一档在手机上有多大。 */
function phoneSizeOf(declaration: Declaration, sharedPhonePx: number): number | null {
  if (declaration.breakpoint !== null) return null
  if (declaration.shared) return sharedPhonePx
  return SIZE_PX[declaration.size!] ?? null
}

/**
 * `field-text` 自己写的两档。
 *
 * 这条规矩的理由就写在这里，所以门禁要真的去读它：手机 16px、桌面 14px。
 */
function fieldTextSizes(): { phone: number; desktop: number } {
  const utility = /@utility\s+field-text\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1]
  expect(utility, '样式表里没有 `field-text` 这个规矩').toBeDefined()

  const rem = (value: string): number => Math.round(Number(value.replace('rem', '')) * 16 * 100) / 100
  const phone = /font-size:\s*([\d.]+rem)/.exec(utility!)?.[1]
  const desktop = /@media[^{]*\{[^}]*font-size:\s*([\d.]+rem)/.exec(utility!)?.[1]

  expect(phone, '`field-text` 没有写手机上的字号').toBeDefined()
  expect(desktop, '`field-text` 没有写桌面上的字号').toBeDefined()
  return { phone: rem(phone!), desktop: rem(desktop!) }
}

/**
 * 样式表里的每一条规则。
 *
 * 括号是配对的，所以扫一遍就能把"选择器"和"里面写了什么"分开。里面还可能有
 * 别的规则——`@media` 里包着一条自己的规则——所以要往里走一层。
 */
function cssRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = []
  const walk = (from: number, to: number): void => {
    let index = from
    while (index < to) {
      const open = css.indexOf('{', index)
      if (open < 0 || open >= to) return
      const selector = css.slice(index, open).trim()
      let depth = 1
      let cursor = open + 1
      while (cursor < to && depth > 0) {
        if (css[cursor] === '{') depth += 1
        else if (css[cursor] === '}') depth -= 1
        cursor += 1
      }
      rules.push({ selector, body: css.slice(open + 1, cursor - 1) })
      walk(open + 1, cursor - 1)
      index = cursor
    }
  }
  walk(0, css.length)
  return rules
}

/** 一条选择器说的是不是输入框。 */
const FIELD_SELECTOR = /(^|[\s,>+~])((input|textarea|select)\b)|contenteditable/

/** 一个常量在这份文件里的值。 */
function constResolver(text: string): (identifier: string) => string | undefined {
  return (identifier: string): string | undefined => constValue(text, identifier)
}

/** 原生的输入框：会显示字、也能被输入的那种。 */
const NATIVE_FIELDS = ['input', 'textarea', 'select']

/** 不显示字的输入框：文件、勾选框、按钮。 */
const NOT_TEXT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

interface Field {
  rel: string
  line: number
  /** 字段自己的 class 表。 */
  list: string
}

/** 一个文件里的原生文本框。 */
function fieldsIn(rel: string, text: string): Field[] {
  const found: Field[] = []
  const resolve = constResolver(text)
  for (const tag of NATIVE_FIELDS) {
    const matcher = new RegExp(`<${tag}\\b`, 'g')
    const lists = classListOfTag(text, tag, resolve)
    let index = 0
    let match: RegExpExecArray | null
    while ((match = matcher.exec(text)) !== null) {
      const opening = tagAt(text, match.index)
      const attrs = opening.slice(tag.length + 1, opening.endsWith('>') ? -1 : undefined)
      const type = /\btype\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
      if (type && NOT_TEXT_TYPES.has(type)) {
        index += 1
        continue
      }
      found.push({
        rel,
        line: text.slice(0, match.index).split('\n').length,
        list: lists[index] ?? '',
      })
      index += 1
    }
  }
  return found
}

/**
 * 共享的字段零件。
 *
 * 认的是**形状**：一个组件自己渲染的那一串类名里写着 `field-text`——那它就是
 * 一个字段，而且它的字号是共享那一份说了算的。`SelectItem` 不是：它是一行
 * 选项，不是一个可以往里写字的框。
 */
interface Part {
  name: string
  rel: string
  /** 它自己声明的那一串类名。 */
  list: string
}

function partsOf(): Part[] {
  const parts: Part[] = []
  for (const source of SOURCES) {
    const resolve = constResolver(source.text)
    const declarations = /(?:\bexport\s+)?(?:const|function)\s+([A-Z][\w$]*)/g
    let match: RegExpExecArray | null
    while ((match = declarations.exec(source.text)) !== null) {
      const name = match[1]!
      const rest = source.text.slice(match.index)
      // 下一个**顶层**的声明。函数里面写的 `const Comp = …` 不是顶层——
      // 拿它当界，零件的那一段代码就被截断在它自己身上了。
      const next = /\n(?:export\s+)?(?:const|function)\s+[A-Z]/.exec(rest.slice(1))
      const body = next ? rest.slice(0, next.index + 1) : rest.slice(0, 2000)
      const list = firstClassListOf(body, resolve)
      if (!list.split(/\s+/).includes(FIELD_TEXT)) continue
      parts.push({ name, rel: source.rel, list })
    }
  }
  return parts
}

/** 一个文件从本地模块里引了什么。 */
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

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    const found = SOURCES.find((source) => source.file === path.normalize(candidate))
    if (found) return found.rel
  }
  return null
}

const FIELDS = SOURCES.flatMap((source) => fieldsIn(source.rel, source.text))
const PARTS = partsOf()

/** 共享零件的调用点：那里也不该再写一次字号。 */
interface CallSite {
  rel: string
  line: number
  part: Part
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    const imported = importsOf(source.rel, source.text)
    for (const part of PARTS) {
      if (imported.get(part.name) !== part.rel) continue
      const matcher = new RegExp(`<${part.name}\\b`, 'g')
      const lists = classListOfTag(source.text, part.name, constResolver(source.text))
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

describe('输入框里的字由共享那一份说了算', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到文本框——不然这道门禁在空集上跑，永远是绿的。
    expect(FIELDS.length, '一个文本框都没找到，这道门禁多半跑在空集上').toBeGreaterThan(15)
    expect(
      FIELDS.some((field) => field.rel === 'components/ui/input.tsx'),
      '连共享的输入框都没有，这道门禁读错了地方',
    ).toBe(true)

    // 找得到共享的字段零件。
    const names = PARTS.map((part) => part.name)
    for (const expected of ['Input', 'Textarea', 'SelectTrigger']) {
      expect(names, `共享的字段零件 ${expected} 没被认出来`).toContain(expected)
    }
    expect(names, '把一行选项当成了字段').not.toContain('SelectItem')

    // 找得到调用点。
    expect(CALL_SITES.length, '一个共享字段的调用点都没找到').toBeGreaterThan(30)

    // 认得出两档，也认得出"这一档在手机上有多大"。
    expect(declarationsOf('field-text'), '认不出共享的那一份').toEqual([
      { token: 'field-text', shared: true, size: null, breakpoint: null },
    ])
    expect(declarationsOf('md:text-sm'), '认不出断点上的那一档').toEqual([
      { token: 'md:text-sm', shared: false, size: 'sm', breakpoint: 'md' },
    ])
    expect(declarationsOf('file:text-sm'), '把文件按钮的字号当成了输入框的').toEqual([])
    expect(declarationsOf('text-foreground'), '把一个颜色类当成了字号').toEqual([])

    // 而且认得出手机上的下限——不然这道门禁可能只是瞎着。
    const sizes = fieldTextSizes()
    expect(sizes.phone, '共享那一份在手机上的字号不是 16px').toBe(16)
    expect(sizes.desktop, '共享那一份在桌面上的字号不是 14px').toBe(14)
    expect(phoneSizeOf(declarationsOf('text-base')[0]!, 16), '认不出 16px 那一档').toBe(16)
    expect(phoneSizeOf(declarationsOf('text-sm')[0]!, 16), '认不出 14px 那一档').toBe(14)
    expect(
      phoneSizeOf(declarationsOf('md:text-sm')[0]!, 16),
      '断点上写的字号在手机上不生效，却当成了有',
    ).toBe(null)
  })

  it('规矩只写在样式表的那一处', () => {
    // 全局那条 `input, textarea, select { font-size: 16px !important }` 越权：
    // 它盖住了 `field-text` 自己，它在 768px 那一格上还在，而且它对每一个
    // 输入框都算数——包括那些根本没打算用这条规矩的。
    const offenders: string[] = []
    for (const rule of cssRules(CSS)) {
      if (!FIELD_SELECTOR.test(rule.selector)) continue
      if (!/font-size\s*:/.test(rule.body)) continue
      offenders.push(`${rule.selector.slice(0, 70)}  →  ${rule.body.replace(/\s+/g, ' ').trim()}`)
    }

    expect(
      offenders,
      [
        '样式表里给输入框直接写了字号：',
        ...offenders,
        '这条规矩写在 `field-text` 里。样式表不要越过它直接改输入框的字。',
      ].join('\n'),
    ).toEqual([])
  })

  it('一个文本框只有一副字号', () => {
    // 一副：不是两处写着同一件事，也不是断点上又写了一档。
    const offenders: string[] = []

    for (const field of FIELDS) {
      const declarations = declarationsOf(field.list)
      if (declarations.length === 1) continue
      offenders.push(
        `${field.rel}:${field.line}  ${declarations.map((d) => d.token).join(' + ') || '(没有)'}`,
      )
    }

    for (const site of CALL_SITES) {
      const declarations = declarationsOf(`${site.part.list} ${site.list}`)
      if (declarations.length === 1) continue
      offenders.push(
        `${site.rel}:${site.line}（${site.part.name}）  ${
          declarations.map((d) => d.token).join(' + ') || '(没有)'
        }`,
      )
    }

    expect(
      offenders,
      [
        `这些文本框的字号写在了不止一处：${offenders.length} 处`,
        ...offenders,
        '一个文本框只有一副字号：普通字段用 `field-text`，名字的字段用名字自己那一档。',
      ].join('\n'),
    ).toEqual([])
  })

  it('一个文本框在手机上不小于 16px', () => {
    // 手机上聚焦一个不到 16px 的输入框，浏览器会自己放大，而且不缩回去。
    // 浏览器自己给输入框的那个默认值是 13.3px——所以"没写"也是一种太小。
    const shared = fieldTextSizes().phone
    const offenders: string[] = []

    const check = (where: string, list: string): void => {
      const declarations = declarationsOf(list)
      const bare = declarations.find((declaration) => declaration.breakpoint === null)
      const size = bare ? phoneSizeOf(bare, shared) : null
      if (size !== null && size >= PHONE_FLOOR_PX) return
      offenders.push(
        `${where}  ${bare ? bare.token : '(手机上没有字号)'}  ${
          size === null ? '浏览器会自己放大' : `${size}px`
        }`,
      )
    }

    for (const field of FIELDS) check(`${field.rel}:${field.line}`, field.list)
    for (const site of CALL_SITES) {
      check(`${site.rel}:${site.line}（${site.part.name}）`, `${site.part.list} ${site.list}`)
    }

    expect(
      offenders,
      [
        `这些文本框在手机上不到 16px：${offenders.length} 处`,
        ...offenders,
        '手机上聚焦它们，浏览器会自己放大，而且不缩回去。',
      ].join('\n'),
    ).toEqual([])
  })
})
