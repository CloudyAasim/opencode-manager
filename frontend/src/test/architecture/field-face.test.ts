import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, constValue, ownListOf, stripComments, tagAt } from './source-text'

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
 * 于是那一轮：**脸只写在一处** ✓（`components/ui/field-face.ts` ✓），
 * 三个零件都从那一处拿 ✓，谁也不许自己再画一张 ✗。
 *
 * 尺寸档可以打磨这张脸（小的字段用小的圆角 ✓），但打磨的方式也一样 ✓——
 * 同一个尺寸名字，在输入框上和在多行框上，是同一个圆角 ✓。
 *
 * 而这一轮补上另一半 ✗：**调用点**也可以自己画一张 ✗——
 * `bg-background border-border` 写了十九处 ✗，`bg-muted border-border` 五处 ✗。
 * 十九个输入框和别的输入框**不是一张脸** ✗——`border-border` 是分隔线的颜色 ✗，
 * 不是输入框的颜色 ✗。而**没有人比过** ✗：这道门禁只看共享的那三个零件 ✗，
 * 压根没看调用点 ✗。
 *
 * 于是这一轮：**调用点也不许自己画脸** ✓——
 * 脸只有一副 ✓，谁也不许再画另一张 ✗。
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

/** 共享的那三个字段零件，它们的名字 ✓。 */
const FIELD_PARTS = ['Input', 'SelectTrigger', 'Textarea']

/**
 * 脸上那几类类名 ✓。
 *
 * **没有前缀的** ✓才是脸本身 ✓——`focus:border-primary` ✗ 是一个**状态** ✗，
 * 不是脸 ✗。
 */
const FACE_TOKEN = /^(?:rounded|bg|border|shadow)(?:-|$)/

/**
 * 一次性的那几处，各有理由。
 *
 * - 问答提示里**正在答的那一栏** ✗：它自己带着一道主色 ✗，
 *   那是一个**状态** ✗——这一栏是亮着的 ✗，不是另一张脸 ✗。
 * - 多选框里的**搜索栏** ✗：它落在**玻璃上** ✗（`bg-surface-glass` ✓），
 *   要透出那层玻璃 ✓，不是另一张卡 ✗。
 * - 环境变量里**被挡住的那一项** ✗：它的边是红的 ✗，
 *   那也是一个**状态** ✗——这一项不让用 ✗，不是另一张脸 ✗。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'features/session/QuestionPrompt.tsx',
    'border-primary',
    '这是**正在答的那一栏** ✗：它自己带着一道主色 ✗，那是状态 ✗，不是脸 ✗',
  ],
  [
    'components/ui/multi-select.tsx',
    'bg-transparent',
    '这一栏在**玻璃上** ✗：它要透出那层玻璃 ✓，不是另一张卡 ✗',
  ],
  [
    'features/settings/ServerEnvVarsSettings.tsx',
    'border-destructive',
    '这一项**被挡住了** ✗：它的边是红的 ✗，那是状态 ✗，不是脸 ✗',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, token: string): boolean {
  return EXCEPTIONS.some(([file, marked]) => file === rel && marked === token)
}

/** 一个共享字段的调用点。 */
interface CallSite {
  rel: string
  line: number
  part: string
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of FIELD_PARTS) {
      const matcher = new RegExp(`<${part}\\b`, 'g')
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        const opening = tagAt(source.text, match.index)
        const attrs = opening.slice(part.length + 1, opening.endsWith('>') ? -1 : undefined)
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          list: classListOfAttrs(attrs) ?? '',
        })
      }
    }
  }
  return found
}

const CALL_SITES = callSites()

const CONSTANTS = new Map([[FACE, FACE_VALUE ?? '']])

function ownListOfPart(rel: string): string {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  if (!source) return ''
  return ownListOf(source.text, CONSTANTS)
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

    // 找得到字段的调用点 ✓。
    expect(CALL_SITES.length, '一个字段的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(50)

    // 认得出"脸上那几类" ✓——以及"自己画了另一张脸"的那种写法 ✓。
    const face = new Set((FACE_VALUE ?? '').split(/\s+/))
    expect(face.has('bg-card'), '共享的那副脸换了背景——换它是一件要说清楚的事').toBe(true)
    expect(
      [...face].filter((token) => FACE_TOKEN.test(token)).length,
      '认不出脸上那几类',
    ).toBeGreaterThan(3)
    expect(FACE_TOKEN.test('bg-background'), '认不出另一个背景').toBe(true)
    expect(FACE_TOKEN.test('border-border'), '认不出另一个边框').toBe(true)
    // 而**状态**不是脸 ✓——带前缀的那一句 ✓ 不算 ✗。
    expect(FACE_TOKEN.test('focus:border-primary'), '把一个状态当成了脸').toBe(false)
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

  it('调用点也不许自己画脸', () => {
    // 脸只有一副 ✓。调用点自己写一个背景 ✗、一道边框 ✗、一个圆角 ✗，
    // 就是**另一张脸** ✗——而 `border-border` 是分隔线的颜色 ✗，
    // 不是输入框的颜色 ✗。
    const face = new Set((FACE_VALUE ?? '').split(/\s+/))
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!FACE_TOKEN.test(token)) continue
        if (face.has(token)) continue
        if (excused(site.rel, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己画了一张脸：${offenders.length} 处`,
        ...offenders,
        `脸只有一副：${FACE}（${FACE_OWNER}）。`,
        '确实只此一处的，写进 EXCEPTIONS 并说明理由。',
      ].join('\n'),
    ).toEqual([])
  })

  it('被点名的那些，理由都写清楚了，而且都还在', () => {
    for (const [rel, token, reason] of EXCEPTIONS) {
      expect(reason.trim().length, `${rel} 的 ${token} 没有写为什么它不一样`).toBeGreaterThan(0)
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `例外里的 ${rel} 已经不存在了`).toBeDefined()
      expect(
        source!.text.includes(token),
        `例外里的 ${rel} 已经不再写 ${token} 了`,
      ).toBe(true)
    }
  })
})
