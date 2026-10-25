import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, heightsFrom, stripComments, tagAt, variantsOf } from './source-text'

/**
 * 断点上的高度只有一副。
 *
 * 42 号那轮统一了**高度档** ✓，但留下一句"从某一档屏幕起更高的是排版的事" ✗——
 * 于是那件事就散在**调用点**上 ✗：`sm:h-10` 写了十一遍 ✗，`md:h-8` 写了六遍 ✗。
 * 每一处都是同一句话 ✗，而没有一处说了它是哪一句话 ✗。
 *
 * 于是这一轮：
 *
 * - **那两句话被写在了楼梯上** ✓：`wide` ✓（一行在宽屏上高一点 ✓）和
 *   `compact` ✓（一行触摸尺寸的控件，在宽屏上回到平常的尺寸 ✓）。
 * - **调用点不再写断点上的高度** ✓——高度是共享零件的事 ✓，包括断点上的那一档 ✓。
 * - **同一个尺寸名字，在按钮上和在字段上，是同一组高度** ✓（平常的那一档 ✓，
 *   和断点上的那一档 ✓）。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的零件：它们的调用点不许再写高度 ✓。 */
const SHARED_PARTS = ['Input', 'SelectTrigger', 'Button']

/** 楼梯上那两个"在某一档屏幕上才不一样"的档 ✓。 */
const RESPONSIVE_STEPS = ['wide', 'compact']

/**
 * 一次性说清的那几个地方。
 *
 * 响应式的高度**不是一句话** ✗——它是好几句 ✗：一行在宽屏上高一点 ✓、
 * 一排触摸目标在宽屏上收回来 ✓，而**只此一处**的 ✗——
 * 一排要挤进屏幕的小按钮 ✗、错误信息里的那个链接 ✗。
 * 一次性的那些**点名** ✓，说清楚它们为什么不一样 ✓。
 *
 * 53 号那轮又收窄了一轮 ✗："一排要挤进屏幕的小按钮" ✗ 那一类 ✗，
 * 其实楼梯上早就有它 ✗（`compact` ✓）——只是那几处自己手写了一半高度 ✗，
 * 而共享的零件在更宽的一档上**把它推了回去** ✗（见 `one-height.test.ts` ✓）。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'pages/SessionDetail.tsx',
    'sm:h-7',
    '会话页头部有**六格** ✗：手机上有五格那么宽 ✗，鼠标上用 28px 的小按钮 ✗（那里有注释写着 ✗）✗',
  ],
  [
    'features/settings/OpenCodeConfigEditor.tsx',
    'md:h-8',
    '这是一个**错误信息里的链接** ✗，它不是共享零件 ✗',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, token: string): boolean {
  return EXCEPTIONS.some(([file, marked]) => file === rel && marked === token)
}

/** 共享的字段与按钮各自的楼梯 ✓。 */
const LADDERS: Record<string, string> = {
  'components/ui/button.tsx': 'Button',
  'components/ui/input.tsx': 'Input',
  'components/ui/select.tsx': 'SelectTrigger',
}

interface CallSite {
  rel: string
  line: number
  part: string
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of SHARED_PARTS) {
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

function variantsOfPart(rel: string): Map<string, string> {
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  return source ? variantsOf(source.text) : new Map()
}

describe('断点上的高度只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到共享零件的调用点 ✓。
    expect(CALL_SITES.length, '一个共享零件的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(50)

    // 认得出"断点上的高度" ✓——无前缀的是平常那一档 ✓，带前缀的是那一档屏幕上的 ✓。
    const heights = heightsFrom('h-8 md:h-9')
    expect(heights.get(''), '认不出平常那一档的高度').toBe(32)
    expect(heights.get('md'), '认不出断点上的高度').toBe(36)
    expect(heightsFrom('w-full flex-1').size, '把别的类当成了高度').toBe(0)

    // 认得楼梯上那两档 ✓。
    for (const [rel] of Object.entries(LADDERS)) {
      const variants = variantsOfPart(rel)
      for (const step of RESPONSIVE_STEPS) {
        expect(variants.has(step), `${rel} 的楼梯上没有 ${step} 这一档`).toBe(true)
      }
    }
  })

  it('调用点不再写断点上的高度', () => {
    // 高度是共享零件的事 ✓，包括"在某一档屏幕上才不一样"的那一档 ✓。
    // 一次性的那几个 ✗，点名了 ✓，说清楚它们为什么不一样 ✓。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const [breakpoint, height] of heightsFrom(site.list)) {
        if (!breakpoint) continue
        const token = `${breakpoint}:h-${height / 4}`
        if (excused(site.rel, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方又写了一遍断点上的高度：${offenders.length} 处`,
        ...offenders,
        '断点上的高度是共享零件的事：它知道自己在哪一档屏幕上有多高（`wide` / `compact`）。',
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

  it('同一个尺寸名字，在按钮上和在字段上，是同一组高度', () => {
    const ladders = Object.entries(LADDERS).map(([rel, part]) => ({
      part,
      variants: variantsOfPart(rel),
    }))

    const offenders: string[] = []
    for (const step of RESPONSIVE_STEPS) {
      const groups = ladders.map(({ part, variants }) => ({
        part,
        heights: heightsFrom(variants.get(step) ?? ''),
      }))
      const reference = groups[0]!
      for (const group of groups.slice(1)) {
        for (const [breakpoint, height] of reference.heights) {
          if (group.heights.get(breakpoint) === height) continue
          offenders.push(
            `${step}  在 ${reference.part} 上是 ${height}px，在 ${group.part} 上是 ${group.heights.get(breakpoint) ?? '(没有)'}px`,
          )
        }
        for (const [breakpoint, height] of group.heights) {
          if (reference.heights.get(breakpoint) === height) continue
          offenders.push(
            `${step}  在 ${group.part} 上是 ${height}px，在 ${reference.part} 上是 ${reference.heights.get(breakpoint) ?? '(没有)'}px`,
          )
        }
      }
    }

    expect(
      offenders,
      [
        `同一个尺寸名字在两处不是同一组高度：${offenders.length} 处`,
        ...offenders,
        '同一个名字就是同一组高度——不然一行里的按钮和字段，在宽屏上又不是一行了。',
      ].join('\n'),
    ).toEqual([])
  })
})
