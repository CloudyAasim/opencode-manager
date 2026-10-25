import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { constValue, ownListOf, stripComments } from './source-text'

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
 * 于是这一轮：
 *
 * - **焦点环只写一处** ✓（`components/ui/focus-ring.ts` ✓），四个零件都从那一处拿 ✓。
 * - 它用的是 `focus-visible:` ✓——**键盘才亮** ✓，鼠标点不亮 ✓。
 * - 下拉框"打开着"的样子改用 `data-[state=open]:` ✓——它就是"打开着" ✓，
 *   不再冒充"聚焦着" ✓。
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

/**
 * Breeze 自己盯着的那几个表单控件。
 *
 * 开关和勾选框不在其中——它们是**开关**，有它们自己的形状 ✓，它们的大小是
 * 它们自己的规矩 ✓。
 */
const FORM_CONTROLS: readonly string[] = [
  'components/ui/button.tsx',
  'components/ui/input.tsx',
  'components/ui/textarea.tsx',
  'components/ui/select.tsx',
]

/** 环的那几部分。 */
const RING_PARTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['环', /\bring-\d+\b/],
  ['环的颜色', /\bring-ring(?:\/\d+)?\b/],
  ['偏移', /\bring-offset-\d+\b/],
  ['偏移到的颜色', /\bring-offset-\w+\b/],
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

const CONSTANTS = new Map([[RING, RING_VALUE ?? '']])

function ownListOfPart(rel: string): string {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  if (!source) return ''
  return ownListOf(source.text, CONSTANTS)
}

describe('焦点只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 环写在那儿。
    expect(RING_VALUE, `找不到 ${RING}（${RING_OWNER}）`).toBeDefined()
    expect(RING_VALUE, '那一圈是空的').not.toBe('')

    // 环的那几部分都写了。
    for (const [name, pattern] of RING_PARTS) {
      expect(tokensOf(RING_VALUE ?? '', pattern).length, `那一圈没有写${name}`).toBeGreaterThan(0)
    }

    // 找得到每一个表单控件，也读得出它自己那一段。
    for (const rel of FORM_CONTROLS) {
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `找不到表单控件 ${rel}`).toBeDefined()
      expect(ownListOfPart(rel), `读不出 ${rel} 自己那一段类名`).not.toBe('')
    }

    // 认得出"聚焦"和"键盘才聚焦"——这两个不一样。
    expect(/\bfocus:/.test('focus:ring-2'), '认不出鼠标也会亮的那个焦点').toBe(true)
    expect(/\bfocus:/.test('focus-visible:ring-2'), '把键盘才亮的当成了鼠标也亮的').toBe(false)
  })

  it('焦点环只写在一处', () => {
    // 每个表单控件都从那一处拿环 ✓，谁也不许自己再画一圈 ✗。
    const offenders: string[] = []
    for (const rel of FORM_CONTROLS) {
      const own = ownListOfPart(rel)
      for (const [name, pattern] of RING_PARTS) {
        const ringTokens = tokensOf(RING_VALUE ?? '', pattern)
        for (const token of tokensOf(own, pattern)) {
          if (ringTokens.includes(token)) continue
          offenders.push(`${rel}  自己画了${name} ${token}（环说的是 ${ringTokens.join(', ')}）`)
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方自己画了一圈焦点：${offenders.length} 处`,
        ...offenders,
        `焦点环只有一副：${RING}（${RING_OWNER}）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('每个表单控件都用上了那一圈', () => {
    const offenders: string[] = []
    for (const rel of FORM_CONTROLS) {
      const own = ownListOfPart(rel)
      for (const [name, pattern] of RING_PARTS) {
        for (const token of tokensOf(RING_VALUE ?? '', pattern)) {
          if (tokensOf(own, pattern).includes(token)) continue
          offenders.push(`${rel}  焦点环少了${name} ${token}`)
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方没有用上共享的那一圈焦点：${offenders.length} 处`,
        ...offenders,
        `焦点环只有一副：${RING}（${RING_OWNER}）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('焦点是键盘的事', () => {
    // 鼠标点一下就亮起来的焦点，是"打开着"或者"按下了" ✗，不是焦点 ✗。
    // 键盘才亮的那个才叫焦点 ✓。
    const offenders: string[] = []
    for (const rel of FORM_CONTROLS) {
      const own = ownListOfPart(rel)
      for (const token of own.split(/\s+/)) {
        if (!token) continue
        if (!/\bfocus:/.test(token)) continue
        offenders.push(`${rel}  ${token}  鼠标点一下也会亮`)
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
