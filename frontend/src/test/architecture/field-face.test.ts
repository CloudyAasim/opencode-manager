import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { constValue, stripComments } from './source-text'

/**
 * 字段只有一副脸。
 *
 * 输入框、下拉框、多行框是同一个零件的三张脸：它们挨着放在同一行里，读起来
 * 应该是同一句话。42 号那轮统一了它们的**身高** ✓，脸却一直各写各的 ✗：
 *
 * | | 圆角 | 背景 | 阴影 |
 * |---|---|---|---|
 * | 输入框 | `rounded-lg` ✓ | `bg-card` ✓ | `shadow-xs` ✓ |
 * | 下拉框 | `rounded-md` ✗ | `bg-background` ✗ | 没有 ✗ |
 * | 多行框 | `rounded-md` ✗ | `bg-background` ✗ | 没有 ✗ |
 *
 * 而按钮和卡片用的是**输入框那一副** ✓（`rounded-lg` / `bg-card` / `shadow-xs` ✓）——
 * 也就是说，一行里放着一个按钮和一个下拉框，它们**不像一家人** ✗。
 *
 * 于是这一轮：**脸只写在一处** ✓（`components/ui/field-face.ts` ✓），
 * 三个零件都从那一处拿 ✓，谁也不许自己再画一张 ✗。
 *
 * 尺寸档可以打磨这张脸（小的字段用小的圆角 ✓），但打磨的方式也一样 ✓——
 * 同一个尺寸名字，在输入框上和在多行框上，是同一个圆角 ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 脸写在哪一处。 */
const FACE_OWNER = 'components/ui/field-face.ts'
const FACE = 'FIELD_FACE'

/** 共享的字段零件。 */
const SHARED_FIELDS: readonly string[] = [
  'components/ui/input.tsx',
  'components/ui/select.tsx',
  'components/ui/textarea.tsx',
]

/**
 * 脸的那几部分。
 *
 * **不包括内边距** ✗：里面留多少空当是 Breeze 那条规矩管的事 ✗
 * （"按钮和文本框内部至少留 8px 的空当" ✓），它管的是"至少" ✗，不是"一模一样" ✗。
 */
const FACE_PARTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['圆角', /\brounded-(?:sm|md|lg|xl|full|none)\b/],
  ['背景', /\bbg-(?:card|background|popover|secondary|muted)\b/],
  ['阴影', /\bshadow-(?:xs|sm|md|lg)\b/],
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

/**
 * 一个调用（`cva(...)` 或 `cn(...)`）的第一段。
 *
 * 那一段就是"这个零件自己长什么样"的地方 ✗——尺寸档改的是别的 ✗。
 */
function firstArgumentOf(text: string, callee: string): string | null {
  const at = text.indexOf(`${callee}(`)
  if (at < 0) return null
  let index = at + callee.length + 1
  while (index < text.length && /\s/.test(text[index]!)) index += 1
  const quote = text[index]
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, index + 1)
    return end < 0 ? null : text.slice(index + 1, end)
  }
  if (quote === '`') {
    let cursor = index + 1
    while (cursor < text.length) {
      if (text[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (text[cursor] === '`') break
      cursor += 1
    }
    return text.slice(index + 1, cursor)
  }
  return null
}

/** 这个零件自己那一段类名。 */
function ownListOf(text: string): string | null {
  return firstArgumentOf(text, 'cva') ?? firstArgumentOf(text, 'cn')
}

/** 把模板里的常量换成它真正的值。 */
function resolveConstants(text: string, values: Map<string, string>): string {
  return text.replace(/\$\{(\w+)\}/g, (whole, name) => values.get(name) ?? whole)
}

/** 尺寸档那一段。 */
function sizeVariantsOf(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const at = text.indexOf('size: {')
  if (at < 0) return found
  let depth = 0
  let end = at
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1
    else if (text[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = text.slice(at, end)
  for (const match of body.matchAll(/"?([\w-]+)"?:\s*"([^"]*)"/g)) {
    found.set(match[1]!, match[2]!)
  }
  return found
}

const FACE_VALUE = constValue(
  SOURCES.find((source) => source.rel === FACE_OWNER)?.text ?? '',
  FACE,
)

const CONSTANTS = new Map([[FACE, FACE_VALUE ?? '']])

function ownListOfPart(rel: string): string {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  if (!source) return ''
  const own = ownListOf(source.text) ?? ''
  return resolveConstants(own, CONSTANTS)
}

describe('字段只有一副脸', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 脸写在那儿。
    expect(FACE_VALUE, `找不到 ${FACE}（${FACE_OWNER}）`).toBeDefined()
    expect(FACE_VALUE, '那张脸是空的').not.toBe('')

    // 脸的那几部分都写了。
    for (const [name, pattern] of FACE_PARTS) {
      expect(
        tokensOf(FACE_VALUE ?? '', pattern).length,
        `那张脸没有写${name}：${FACE_VALUE}`,
      ).toBeGreaterThan(0)
    }

    // 找得到每一个共享的字段零件，也读得出它自己那一段。
    for (const rel of SHARED_FIELDS) {
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `找不到共享的字段零件 ${rel}`).toBeDefined()
      expect(ownListOfPart(rel), `读不出 ${rel} 自己那一段类名`).not.toBe('')
    }

    // 认得出"这段里没有这一类"和"这段里有另一个"——这两个不一样。
    expect(tokensOf('rounded-lg bg-card', FACE_PARTS[0]![1]), '认不出圆角').toEqual(['rounded-lg'])
    expect(tokensOf('rounded-md', FACE_PARTS[0]![1]), '认不出另一个圆角').toEqual(['rounded-md'])
    expect(tokensOf('flex w-full px-3', FACE_PARTS[0]![1]), '把内边距当成了圆角').toEqual([])
  })

  it('脸只写在一处', () => {
    // 每一个共享的字段零件，都从那一处拿脸 ✓。
    // 谁自己再画一张（另一个圆角、另一种背景、另一道阴影、另一份内边距）✗，
    // 门禁就报出来 ✗。
    const offenders: string[] = []
    for (const rel of SHARED_FIELDS) {
      const own = ownListOfPart(rel)
      for (const [name, pattern] of FACE_PARTS) {
        const faceTokens = tokensOf(FACE_VALUE ?? '', pattern)
        const ownTokens = tokensOf(own, pattern)
        for (const token of ownTokens) {
          if (faceTokens.includes(token)) continue
          offenders.push(`${rel}  自己写了${name} ${token}（脸说的是 ${faceTokens.join(', ')}）`)
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方自己画了一张脸：${offenders.length} 处`,
        ...offenders,
        `脸只有一副：${FACE}（${FACE_OWNER}）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('每个共享的字段零件都用上了那副脸', () => {
    const offenders: string[] = []
    for (const rel of SHARED_FIELDS) {
      const source = SOURCES.find((candidate) => candidate.rel === rel)!
      if (!source.text.includes(FACE)) {
        offenders.push(`${rel}  没有用上 ${FACE}`)
        continue
      }
      const own = ownListOfPart(rel)
      for (const [name, pattern] of FACE_PARTS) {
        for (const token of tokensOf(FACE_VALUE ?? '', pattern)) {
          if (!tokensOf(own, pattern).includes(token)) {
            offenders.push(`${rel}  脸上少了${name} ${token}`)
          }
        }
      }
    }

    expect(
      offenders,
      [
        `这些地方没有用上共享的那副脸：${offenders.length} 处`,
        ...offenders,
        `脸只有一副：${FACE}（${FACE_OWNER}）。`,
      ].join('\n'),
    ).toEqual([])
  })

  it('同一个尺寸档上的脸，字段之间是一致的', () => {
    // 小的字段用小的圆角 ✓——这是应用的那条尺度规矩 ✓。
    // 但两个零件得用同一档 ✓：同一个尺寸名字，在输入框上和在多行框上，
    // 是同一个圆角 ✓。
    const offenders: string[] = []
    const bySize = new Map<string, Map<string, string>>()
    for (const rel of SHARED_FIELDS) {
      const source = SOURCES.find((candidate) => candidate.rel === rel)!
      const variants = sizeVariantsOf(source.text)
      for (const [size, list] of variants) {
        const radii = tokensOf(list, FACE_PARTS[0]![1])
        if (radii.length === 0) continue
        const seen = bySize.get(size) ?? new Map<string, string>()
        seen.set(rel, radii.join(' '))
        bySize.set(size, seen)
      }
    }

    for (const [size, seen] of bySize) {
      const distinct = [...new Set(seen.values())]
      if (distinct.length <= 1) continue
      offenders.push(
        `${size}  这一档的圆角不是一个：${[...seen].map(([rel, radius]) => `${rel} ${radius}`).join(' / ')}`,
      )
    }

    expect(
      offenders,
      [
        `同一个尺寸档上的圆角不是一个：${offenders.length} 处`,
        ...offenders,
        '小的字段用小的圆角——两个零件得用同一档。',
      ].join('\n'),
    ).toEqual([])
  })
})
