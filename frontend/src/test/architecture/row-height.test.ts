import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import {
  BREAKPOINTS,
  classListOfAttrs,
  elementTree,
  familyOf,
  heightOf,
  heightsFrom,
  stripComments,
  variantsOf,
} from './source-text'

/**
 * 一行里的字段和按钮，是同一档。
 *
 * 一行里放着一个按钮和一个字段，它们是**同一行** ✓——高度差着 4px ✗，
 * 读起来就是两句话 ✗。41 号那轮统一了按钮与字段的**高度档** ✓，
 * 48 号那轮统一了它们的**脸** ✓，但**断点上的高度** ✗ 还能在调用点上各写各的 ✗：
 * 查找栏里 ✗，输入框在宽屏上是 36px ✗，而它旁边的按钮是 32px ✗——**它们不是一行** ✗。
 *
 * 所以这一轮：
 *
 * - **一行里的字段和按钮，在每一档屏幕上都得是同一个高度** ✓。
 * - 判的是**形状** ✓：一行是**一个容器** ✓，里面放着一个字段 ✓ 和按钮 ✓；
 *   它们的高度从**各自的尺寸档**里来 ✓（`size="lg"` 是 40 ✓），
 *   再由**调用点**在断点上改写 ✓（`md:h-8` ✓）。
 *
 * 而**每一档屏幕** ✗——不是"两边提到过的那几档" ✗：
 * 之前门禁只比调用点写过高度的那几档 ✗，于是一边在 `wide` ✓、
 * 一边在 `compact` ✓ 的两个零件 ✗，在**谁都没提过**的断点上 ✗，
 * 从来没有被人比过 ✗。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的字段零件 ✓。 */
const FIELDS = new Set(['Input', 'SelectTrigger', 'Textarea'])
/** 共享的按钮 ✓。 */
const BUTTONS = new Set(['Button'])

interface Part {
  name: string
  /** 它要的那一档 ✓。 */
  size: string | null
  /** 调用点自己写的那一串类名 ✓。 */
  list: string
}

function partOf(name: string, size: string | null, list = ''): Part {
  return { name, size, list }
}

/** 某一档屏幕上，一个成员有多高 ✓。 */
function heightOn(part: Part, variants: Map<string, string>, width: string): number | null {
  const step = part.size ? variants.get(part.size) ?? '' : ''
  return heightOf([heightsFrom(step), heightsFrom(part.list)], width)
}

/**
 * 这一行里，哪几档屏幕要比 ✓。
 *
 * 两边说过的每一档 ✓，还有平常那一档 ✓——**每一档屏幕都算** ✓，
 * 不是只有"两边都提到过"的那几档 ✓。
 */
function widthsToCompare(
  field: Part,
  button: Part,
  fieldVariants: Map<string, string>,
  buttonVariants: Map<string, string>,
): string[] {
  const widths = new Set<string>([''])
  for (const [part, variants] of [
    [field, fieldVariants],
    [button, buttonVariants],
  ] as const) {
    const step = part.size ? variants.get(part.size) ?? '' : ''
    for (const key of heightsFrom(step).keys()) widths.add(key)
    for (const key of heightsFrom(part.list).keys()) widths.add(key)
  }
  return [...widths].sort((a, b) => BREAKPOINTS.indexOf(a) - BREAKPOINTS.indexOf(b))
}

/**
 * 这一行里的字段与按钮，哪一档屏幕上不是同一个高度 ✓。
 */
function mismatches(
  field: Part,
  button: Part,
  fieldVariants: Map<string, string>,
  buttonVariants: Map<string, string>,
): string[] {
  const found: string[] = []
  for (const width of widthsToCompare(field, button, fieldVariants, buttonVariants)) {
    const fieldHeight = heightOn(field, fieldVariants, width)
    const buttonHeight = heightOn(button, buttonVariants, width)
    if (fieldHeight === null || buttonHeight === null) continue
    if (fieldHeight === buttonHeight) continue
    found.push(
      `${field.name}(${field.size ?? '默认'}) 在${width || '平常'}是 ${fieldHeight}px，` +
        `旁边的 ${button.name}(${button.size ?? '默认'}) 是 ${buttonHeight}px`,
    )
  }
  return found
}

/** 一行里的成员 ✓。 */
interface Row {
  rel: string
  line: number
  fields: Part[]
  buttons: Part[]
}

function rowsIn(rel: string, text: string): Row[] {
  const found: Row[] = []
  for (const element of elementTree(text)) {
    // 一行是**横着排**的容器 ✓（竖着排的不是一行 ✗）。
    const classes = classListOfAttrs(element.opening) ?? ''
    if (!/(^|\s)flex(\s|$)/.test(classes)) continue
    if (/(^|\s)flex-col(\s|$)/.test(classes)) continue
    // 一行里的成员 ✓：字段与按钮**住在这一行里** ✓（输入框常常包在一个
    // 装图标的盒子里 ✗，所以看的是这一行的**后代** ✗，不是它的孩子 ✗）。
    const family = familyOf(element)
    if (family.length === 0) continue
    const fields: Part[] = []
    const buttons: Part[] = []
    for (const child of family) {
      const size = /\bsize="([^"]*)"/.exec(child.opening)?.[1] ?? null
      const part: Part = { name: child.name, size, list: classListOfAttrs(child.opening) ?? '' }
      if (FIELDS.has(child.name)) fields.push(part)
      else if (BUTTONS.has(child.name)) buttons.push(part)
    }
    if (fields.length === 0 || buttons.length === 0) continue
    found.push({
      rel,
      line: text.slice(0, element.start).split('\n').length,
      fields,
      buttons,
    })
  }
  return found
}

const ROWS = SOURCES.flatMap((source) => rowsIn(source.rel, source.text))

const BUTTON_VARIANTS = variantsOf(
  SOURCES.find((source) => source.rel === 'components/ui/button.tsx')!.text,
)
const FIELD_VARIANTS = variantsOf(
  SOURCES.find((source) => source.rel === 'components/ui/input.tsx')!.text,
)

describe('一行里的字段和按钮，是同一档', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到那些"一个字段挨着一个按钮"的行 ✓。
    expect(ROWS.length, '一行里的字段和按钮都没找到，这道门禁多半跑在空集上').toBeGreaterThan(3)

    // 认得出"某一档屏幕上的高度" ✓——无前缀的是平常那一档 ✓，带前缀的是那一档屏幕上的 ✓。
    expect(heightsFrom('h-8 md:h-9').get(''), '认不出平常那一档的高度').toBe(32)
    expect(heightsFrom('h-8 md:h-9').get('md'), '认不出断点上的高度').toBe(36)
    expect(heightsFrom('h-8').get('md'), '把没写的高度当成了有的').toBeUndefined()

    // **认得出"这一行对不上"** ✓——不然这道门禁在空集上跑，永远是绿的 ✓。
    const field = partOf('Input', 'lg', 'md:h-9')
    const button = partOf('Button', 'icon-touch')
    expect(
      mismatches(field, button, FIELD_VARIANTS, BUTTON_VARIANTS).length,
      '认不出"输入框 36px、旁边的按钮 32px"这一行',
    ).toBe(1)
    // 而对齐了的那一行 ✓，不该被报出来 ✓。
    expect(
      mismatches(partOf('Input', 'lg', 'md:h-8'), partOf('Button', 'icon-touch'), FIELD_VARIANTS, BUTTON_VARIANTS)
        .length,
      '把对齐了的那一行当成了没对齐',
    ).toBe(0)

    // **两边说的不是同一档、而谁都没在断点上写过高度时，也要比** ✓——
    // 之前门禁只比"两边提到过"的那几档 ✗，于是这种行从来没被比过 ✗。
    expect(
      mismatches(partOf('Input', 'compact'), partOf('Button', 'wide'), FIELD_VARIANTS, BUTTON_VARIANTS).length,
      '认不出"两边档位不同、而谁都没写过高度"这一行',
    ).toBeGreaterThan(0)
  })

  it('一行里的字段和按钮，在每一档屏幕上都是同一个高度', () => {
    const offenders: string[] = []
    for (const row of ROWS) {
      for (const field of row.fields) {
        for (const button of row.buttons) {
          for (const found of mismatches(field, button, FIELD_VARIANTS, BUTTON_VARIANTS)) {
            offenders.push(`${row.rel}:${row.line}  ${found}`)
          }
        }
      }
    }

    expect(
      offenders,
      [
        `这些行里的字段和按钮不是一个高度：${offenders.length} 处`,
        ...offenders,
        '一行里的字段和按钮，在每一档屏幕上都得是同一个高度。',
      ].join('\n'),
    ).toEqual([])
  })
})
