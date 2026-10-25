import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { constValue, ownListOf, stringLiterals, stripComments } from './source-text'

/**
 * 焦点只有一副。
 *
 * 按钮、输入框、下拉框、多行框是同一个应用里**挨着放**的东西——它们挨在一起的
 * 时候，焦点应该从这一个走到下一个，**长得一样** ✓。而它们原来各画各的 ✗：
 *
 * | | 焦点那一圈 |
 * |---|---|
 * | 按钮 | `ring-ring/40` ✓ + 偏移 ✓ + 偏移到背景色 ✓ |
 * | 输入框 | `ring-ring/25` ✗，**没有偏移** ✗ |
 * | 多行框 | **连环都没有** ✗，只有一圈变蓝的边框 ✗ |
 * | 下拉框 | 更粗的一圈（`ring-ring` ✗）+ 偏移 ✓——而且它用 `focus:` 画着**"打开着"的样子** ✗ |
 *
 * 后一条更要紧：下拉框用 `focus:` 画"打开着" ✗，于是**鼠标点它一下** ✗，
 * 它就长得像被键盘选中了 ✗——"聚焦"和"打开着"被混成了一件事 ✗。
 *
 * 于是：
 *
 * - **焦点环只写一处** ✓（`components/ui/focus-ring.ts` ✓），几个零件都从那一处拿 ✓。
 * - 它用的是 `focus-visible:` ✓——**键盘才亮** ✓，鼠标点不亮 ✓。
 * - 下拉框"打开着"的样子改用 `data-[state=open]:` ✓——它就是"打开着" ✓，
 *   不再冒充"聚焦着" ✓。
 * - **浓淡是唯一的例外** ✗：一个 16px 的勾选框 ✗，套一圈 40% 的淡环 ✗，
 *   键盘上的人根本看不见 ✗。所以**更小的目标用更浓的那一副** ✓——
 *   它也写在同一处 ✓，免得又变成"谁自己画的一圈" ✗。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 焦点环写在哪一处。 */
const RING_OWNER = 'components/ui/focus-ring.ts'
const RING = 'FOCUS_RING'
const RING_STRONG = 'FOCUS_RING_STRONG'

/**
 * 戴**标准**那一副的零件。
 *
 * Breeze 自己盯着的那几个表单控件 ✓（按钮、输入框、下拉框、多行框 ✓）都在其中 ✓；
 * 标签页也在其中 ✓——它就是一行里挨着放的按钮 ✓。
 */
const STANDARD_PARTS: readonly string[] = [
  'components/ui/button.tsx',
  'components/ui/input.tsx',
  'components/ui/textarea.tsx',
  'components/ui/select.tsx',
  'components/ui/tabs.tsx',
]

/**
 * 戴**更浓**那一副的零件。
 *
 * 它们是**开关** ✓——Breeze 把它们排除在表单控件之外 ✓（它们有它们自己的形状 ✓），
 * 但**焦点环说的是"键盘在哪"** ✓，跟形状无关 ✗……
 * 除非目标小到那圈淡环看不见 ✗。
 */
const STRONG_PARTS: readonly string[] = [
  'components/ui/checkbox.tsx',
  'components/ui/switch.tsx',
]

/** 字段最小的一档（见 `field-height.test.ts` ✓）——比它还小的目标才配浓的圈 ✓。 */
const SMALLEST_FIELD_PX = 32

/**
 * 环的那几部分。
 *
 * 只认**焦点上**的那一圈 ✗——一个零件身上的别的东西（开关滑块上那个
 * `ring-0` ✗，它只是不让滑块自己长出一圈 ✗）不算焦点环 ✗。
 */
const RING_PARTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['环', /\bfocus-visible:ring-(?!0\b)\d+\b/],
  ['环的颜色', /\bfocus-visible:ring-ring(?:\/\d+)?\b/],
  ['偏移', /\bfocus-visible:ring-offset-\d+\b/],
  ['偏移到的颜色', /\bfocus-visible:ring-offset-\w+\b/],
]

/** 一串类名里的某一类，各是什么。 */
function tokensOf(list: string, pattern: RegExp): string[] {
  const found: string[] = []
  for (const token of list.split(/\s+/)) {
    if (!token) continue
    if (pattern.test(token)) found.push(token)
  }
  return found
}

const RING_VALUE = constValue(SOURCES.find((source) => source.rel === RING_OWNER)?.text ?? '', RING)
const STRONG_VALUE = constValue(
  SOURCES.find((source) => source.rel === RING_OWNER)?.text ?? '',
  RING_STRONG,
)

const CONSTANTS = new Map([
  [RING, RING_VALUE ?? ''],
  [RING_STRONG, STRONG_VALUE ?? ''],
])

/** 一个零件自己那一段类名。 */
function ownListOfPart(rel: string): string {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  if (!source) return ''
  return ownListOf(source.text, CONSTANTS)
}

/**
 * 这个零件身上每一段提到"圈"的类名。
 *
 * 一个零件的圈可能写在它自己的第一段里 ✓（`cva(...)` 的那段 ✓），
 * 也可能写在 `cn(...)` 的**某一个**参数里 ✓——所以这里扫的是**整个文件**里
 * 提到圈的类名 ✓，而不是第一段 ✓。
 */
function ringListsOf(rel: string): string[] {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  if (!source) return []
  // 把模板里的常量换成它真正的值 ✓，那一圈才看得见 ✓。
  const resolved = source.text.replace(
    /\$\{(\w+)\}/g,
    (whole, name) => CONSTANTS.get(name) ?? whole,
  )
  return stringLiterals(resolved).filter((list) => /\bring[-\/]/.test(list))
}

/** 这个零件自己有多大（第一段写着固定尺寸的那一段 ✗）。 */
function sizeOf(rel: string): number | null {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  if (!source) return null
  const resolved = source.text.replace(
    /\$\{(\w+)\}/g,
    (whole, name) => CONSTANTS.get(name) ?? whole,
  )
  for (const list of stringLiterals(resolved)) {
    const match = /\b(?:h|size)-(\d+)\b/.exec(list)
    if (match) return Number(match[1]) * 4
  }
  return null
}

/** 这个零件该戴哪一副。 */
function ringOf(rel: string): string {
  return STRONG_PARTS.includes(rel) ? (STRONG_VALUE ?? '') : (RING_VALUE ?? '')
}

describe('焦点只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 两副圈都写在那儿。
    expect(RING_VALUE, `找不到 ${RING}（${RING_OWNER}）`).toBeDefined()
    expect(STRONG_VALUE, `找不到 ${RING_STRONG}（${RING_OWNER}）`).toBeDefined()
    expect(RING_VALUE, '那一圈是空的').not.toBe('')
    expect(STRONG_VALUE, '更浓的那一圈是空的').not.toBe('')

    // 圈的那几部分都写了。
    for (const [name, pattern] of RING_PARTS) {
      expect(tokensOf(RING_VALUE ?? '', pattern).length, `那一圈没有写${name}`).toBeGreaterThan(0)
    }

    // 浓的那一副，浓的只是环的颜色——别的都一样。
    expect(
      tokensOf(STRONG_VALUE ?? '', RING_PARTS[1]![1]),
      '更浓的那一副没有写环的颜色',
    ).not.toEqual(tokensOf(RING_VALUE ?? '', RING_PARTS[1]![1]))
    for (const [name, pattern] of RING_PARTS) {
      if (name === '环的颜色') continue
      expect(
        tokensOf(STRONG_VALUE ?? '', pattern),
        `更浓的那一副，${name}不该和那一副不一样`,
      ).toEqual(tokensOf(RING_VALUE ?? '', pattern))
    }

    // 找得到每一个零件，也读得出它自己那一段。
    for (const rel of [...STANDARD_PARTS, ...STRONG_PARTS]) {
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `找不到零件 ${rel}`).toBeDefined()
      expect(ownListOfPart(rel), `读不出 ${rel} 自己那一段类名`).not.toBe('')
    }

    // 认得出"聚焦"和"键盘才聚焦"——这两个不一样。
    expect(/\bfocus:/.test('focus:ring-2'), '认不出鼠标也会亮的那个焦点').toBe(true)
    expect(/\bfocus:/.test('focus-visible:ring-2'), '把键盘才亮的当成了鼠标也亮的').toBe(false)
  })

  it('焦点环只写在一处', () => {
    // 每个零件都从那两副里挑一副 ✓，谁也不许自己再画一圈 ✗。
    const offenders: string[] = []
    for (const rel of [...STANDARD_PARTS, ...STRONG_PARTS]) {
      const expected = ringOf(rel)
      for (const list of ringListsOf(rel)) {
        for (const [name, pattern] of RING_PARTS) {
          const allowed = tokensOf(expected, pattern)
          for (const token of tokensOf(list, pattern)) {
            if (allowed.includes(token)) continue
            offenders.push(`${rel}  自己画了${name} ${token}（它该用的是 ${allowed.join(', ')}）`)
          }
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方自己画了一圈焦点：${offenders.length} 处`,
        ...offenders,
        `焦点环只有一副：${RING} / ${RING_STRONG}（${RING_OWNER}）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('每个零件都用上了共享的那一圈', () => {
    const offenders: string[] = []
    for (const rel of [...STANDARD_PARTS, ...STRONG_PARTS]) {
      const own = ringListsOf(rel)
      const expected = ringOf(rel)
      for (const [name, pattern] of RING_PARTS) {
        for (const token of tokensOf(expected, pattern)) {
          const has = own.some((list) => tokensOf(list, pattern).includes(token))
          if (has) continue
          offenders.push(`${rel}  焦点环少了${name} ${token}`)
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方没有用上共享的那一圈焦点：${offenders.length} 处`,
        ...offenders,
        `焦点环只有一副：${RING} / ${RING_STRONG}（${RING_OWNER}）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('更浓的那一副，只给更小的目标', () => {
    // 一个 40% 的淡环套在 16px 的勾选框上 ✗，键盘上的人看不见 ✗。
    // 所以更浓的那一副 ✗，只给比字段最小的一档还小的目标 ✓。
    const offenders: string[] = []
    for (const rel of STRONG_PARTS) {
      const pixels = sizeOf(rel)
      if (pixels === null) {
        offenders.push(`${rel}  读不出它自己有多大`)
        continue
      }
      if (pixels >= SMALLEST_FIELD_PX) {
        offenders.push(
          `${rel}  有 ${pixels}px，不比字段最小的一档（${SMALLEST_FIELD_PX}px）小，不该用更浓的那一副`,
        )
      }
    }

    expect(
      offenders,
      [
        `更浓的那一圈给错了目标：${offenders.length} 处`,
        ...offenders,
        `比字段最小的一档（${SMALLEST_FIELD_PX}px）还小的目标，才用更浓的那一圈。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('焦点是键盘的事', () => {
    // 鼠标点一下就亮起来的焦点，是"打开着"或者"按下了" ✗，不是焦点 ✗。
    // 键盘才亮的那个才叫焦点 ✓。
    //
    // 判的是**零件自己身上**的那一圈 ✓（它自己那一段 ✓，和它带圈的那些段 ✓）——
    // 一行**选项**被点亮 ✗（radix 用 `focus:` 标出键盘走到的那一行 ✓），
    // 那是"当前选中" ✗，不是焦点环 ✗。
    const offenders: string[] = []
    for (const rel of [...STANDARD_PARTS, ...STRONG_PARTS]) {
      for (const list of ringListsOf(rel)) {
        for (const token of list.split(/\s+/)) {
          if (!token) continue
          if (!/\bfocus:/.test(token)) continue
          offenders.push(`${rel}  ${token}  鼠标点一下也会亮`)
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方的焦点是鼠标点一下也会亮的：${offenders.length} 处`,
        ...offenders,
        '焦点用 `focus-visible:`——键盘才亮。"打开着"的样子用 `data-[state=open]:`。',
      ].join('\n'),
    ).toEqual([])
  })
})
