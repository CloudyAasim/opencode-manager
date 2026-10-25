import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, stripComments, tagAt, variantsOf } from './source-text'

/**
 * 共享零件的脸，各有各副。
 *
 * 徽章和警告也有一道**档**（variant ✓）——徽章四副 ✓（`default` ✓、`secondary` ✓、
 * `destructive` ✓、`outline` ✓），警告两副 ✓（`default` ✓、`destructive` ✓）。
 *
 * 可是**没有"成功"和"警告"这两副** ✗——于是想要一个绿色的徽章 ✗，
 * 就在调用点上自己写 `bg-success` ✗；想要一个警告色的 ✗，就自己写 `border-warning` ✗。
 * 十五个地方 ✗，每一种还都写着**不止一种写法** ✗（绿的有白字 ✗、有绿图标 ✗）。
 *
 * 而且其中两种**看不见** ✗：
 *
 * - 一个绿色的徽章写 `bg-success text-success` ✗——`bg-success` 是 `#27ae60` ✗，
 *   `text-success` **也是** `#27ae60` ✗：**字和它自己的底一个颜色** ✗。
 * - 一个提示框写 `border-primary bg-primary` ✗——底下是主色 ✗，
 *   字却还是页面的颜色 ✗。
 *
 * 所以这一轮：
 *
 * - **它们有了名字** ✓：徽章多了 `success` ✓、`warning` ✓、`outline-warning` ✓，
 *   警告多了 `success` ✓、`primary` ✓——和尺寸的那道楼梯一样 ✓，
 *   每一副写明自己的脸 ✓。
 * - **一副脸里，字和底不许是同一个颜色** ✓。
 * - **调用点不许自己写脸** ✓（和按钮 ✗、字段 ✗ 一样 ✓）。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 这一轮管的两个零件 ✓，和它们各自的文件 ✓。 */
const PARTS: Record<string, string> = {
  Badge: 'components/ui/badge.tsx',
  Alert: 'components/ui/alert.tsx',
}

/** 所有的"有档的"零件 ✓——颜色那一道规矩管的是全部 ✓。 */
const WITH_VARIANTS: Record<string, string> = {
  ...PARTS,
  Button: 'components/ui/button.tsx',
}

/**
 * 脸上那几类 ✓。
 *
 * **没有前缀的** ✓才是脸本身 ✓——带前缀的那一句 ✗ 是**状态** ✗
 * （`hover:bg-muted` ✓ 是悬停时变灰 ✓），不是另一张脸 ✗。
 */
const FACE_TOKEN = /^(?:rounded|bg|border|shadow)(?:-|$)/

/**
 * **哪一边**的那些 ✗ 是在改**形状** ✓，不是另一张脸 ✗。
 */
const SHAPE_TOKEN = /^(?:rounded|border)-(?:[lrtybxy]{1,2})(?:-|$)/

/** 每一档说了什么 ✓。 */
function variantsOfPart(rel: string): Map<string, string> {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  return source ? variantsOf(source.text, 'variant') : new Map()
}

/** 那一档说过的每一个词 ✓。 */
function saidBy(variants: Map<string, string>, variant: string): Set<string> {
  const words = new Set<string>()
  for (const token of (variants.get(variant) ?? '').split(/\s+/)) {
    if (token) words.add(token)
  }
  return words
}

/**
 * 一次性的那两处。
 *
 * 错误横幅有**它自己的样子** ✗：一张卡片 ✓，左边一道红线 ✓——
 * 那不是普通警告的样子 ✗，是**错误横幅**的样子 ✓。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'components/ui/error-banner.tsx',
    'bg-card',
    '错误横幅是**一张卡片** ✗，不是普通警告 ✗',
  ],
  [
    'components/ui/error-banner.tsx',
    'border-border',
    '错误横幅是**一张卡片** ✗，不是普通警告 ✗',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, token: string): boolean {
  return EXCEPTIONS.some(([file, marked]) => file === rel && marked === token)
}

interface CallSite {
  rel: string
  line: number
  part: string
  variant: string
  list: string
}

function callSites(parts: Record<string, string>): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of Object.keys(parts)) {
      const matcher = new RegExp(`<${part}\\b`, 'g')
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        const opening = tagAt(source.text, match.index)
        const attrs = opening.slice(part.length + 1, opening.endsWith('>') ? -1 : undefined)
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          variant: /(?:^|\s)variant="([^"]*)"/.exec(attrs)?.[1] ?? 'default',
          list: classListOfAttrs(attrs) ?? '',
        })
      }
    }
  }
  return found
}

const CALL_SITES = callSites(PARTS)

describe('共享零件的脸，各有各副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 每一副都写着什么 ✓。
    for (const [part, rel] of Object.entries(PARTS)) {
      const variants = variantsOfPart(rel)
      expect(variants.size, `共享的 ${part} 没有档，这道门禁多半读错了地方`).toBeGreaterThan(2)
    }
    expect(variantsOfPart(PARTS.Badge!).has('success'), '徽章没有成功那一副').toBe(true)
    expect(variantsOfPart(PARTS.Alert!).has('success'), '警告没有成功那一副').toBe(true)

    // 找得到调用点 ✓。
    expect(CALL_SITES.length, '一个徽章或警告的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(10)

    // 认得脸上那几类 ✓——以及"带前缀的是状态" ✓、"哪一边的是形状" ✓。
    expect(FACE_TOKEN.test('bg-success'), '认不出一个背景').toBe(true)
    expect(FACE_TOKEN.test('border-warning'), '认不出一道边框').toBe(true)
    expect(FACE_TOKEN.test('hover:bg-muted'), '把一个状态当成了脸').toBe(false)
    expect(SHAPE_TOKEN.test('rounded-l-none'), '认不出一个形状').toBe(true)
  })

  it('一副脸里，字和底不许是同一个颜色', () => {
    // `bg-success` 是 `#27ae60` ✗，`text-success` **也是** ✗——
    // 字和它自己的底一个颜色 ✗，**看不见** ✗。
    // 半透明的底 ✗（`bg-destructive/10` ✓）不算 ✗：那底子几乎透明 ✗，字看得见 ✓。
    const offenders: string[] = []
    for (const [part, rel] of Object.entries(WITH_VARIANTS)) {
      for (const [name, list] of variantsOfPart(rel)) {
        const tokens = list.split(/\s+/).filter(Boolean)
        const background = tokens.find((token) => /^bg-[a-z-]+$/.test(token))?.slice(3)
        const text = tokens.find((token) => /^text-[a-z-]+$/.test(token))?.slice(5)
        if (!background || !text) continue
        if (background !== text) continue
        offenders.push(`${part}  ${name}  这一副 底和字都是 ${background}`)
      }
    }

    expect(
      offenders,
      [
        `这些副脸里，字和底是同一个颜色：${offenders.length} 处`,
        ...offenders,
        '字要看得见：底是一个颜色，字就得是另一个。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不许重复它那一档说过的话', () => {
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      const said = saidBy(variantsOfPart(PARTS[site.part]!), site.variant)
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!said.has(token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part} ${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方把那一档的话又说了一遍：${offenders.length} 处`,
        ...offenders,
        '徽章和警告的脸是它们那一档的事：要哪一副，就说哪一副。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不许自己写脸上那几类', () => {
    // **带前缀的那一句不算** ✓——那是**状态** ✗。
    // **哪一边的那一句也不算** ✓——那是**形状** ✗。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!FACE_TOKEN.test(token)) continue
        if (SHAPE_TOKEN.test(token)) continue
        if (excused(site.rel, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part} ${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了一张脸：${offenders.length} 处`,
        ...offenders,
        '要哪一副脸，就说哪一副（`variant="success"`、`variant="outline-warning"`）。',
        '状态不是脸——`hover:` 那一类不算；形状也不是脸——`rounded-l-none` 那一类不算。',
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
