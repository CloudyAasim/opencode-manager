import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, heightsFrom, stripComments, tagAt, variantsOf } from './source-text'

/**
 * 一个高度，一处说了算。
 *
 * 52 号那轮把"从某一档屏幕起更高"这句话放到了楼梯上 ✓，可是有一处地方，两边各说了
 * 一半 ✗：共享的按钮在 `md:` 上说 36px ✓，调用点在 `sm:` 上说 32px ✓。
 * 两处说的是**同一档屏幕上的同一个高度** ✗，而样式表按断点的先后决定谁赢 ✗——
 * 于是那个按钮在 640px 上是 32px，在 768px 上变成 36px ✗：**屏幕越宽，按钮越高** ✗。
 *
 * 写代码的人以为他说清楚了（"宽屏上小一点" ✓），而没有人写下它在每一档屏幕上
 * 到底多高 ✗——**没有人说的那一半，是样式表替它决定的** ✗。
 *
 * 所以这一轮：
 *
 * - **凡是覆盖，都必须一路成立** ✓：调用点一旦说了"从这一档起是这个高度" ✓，
 *   那它就得从那一档一直成立到最宽的那一档 ✓；共享的零件自己在更宽的一档上说的
 *   话，不许把它推回去 ✗。
 * - **楼梯自己也不许在宽屏上变高** ✓：一个尺寸档在更宽的屏幕上只许变小或不变 ✓——
 *   `wide` 那一档是唯一的例外 ✓，因为它的故事就是"宽屏上更宽裕" ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的零件 ✓，和它们各自写明自己那一档的文件 ✓。 */
const SHARED_PARTS: Record<string, string> = {
  Button: 'components/ui/button.tsx',
  Input: 'components/ui/input.tsx',
  SelectTrigger: 'components/ui/select.tsx',
}

/** 屏幕从窄到宽 ✓。 */
const BREAKPOINTS = ['', 'sm', 'md', 'lg', 'xl', '2xl']

/**
 * 可以在宽屏上变高的档 ✓。
 *
 * 只有 `wide` 那一档 ✓——它的故事就是"一行在宽屏上更宽裕" ✓。
 * 别的档在宽屏上变高 ✗，就是**屏幕越宽，那个东西反而越大** ✗。
 */
const GROWING = new Set(['wide'])

/** 一段高度的故事：断点 → 多少像素 ✓。 */
type Story = Map<string, number>

function rankOf(breakpoint: string): number {
  return BREAKPOINTS.indexOf(breakpoint)
}

/**
 * 几段故事放在一起时，在某一档屏幕上生效的是哪一句。
 *
 * 样式表按断点的先后排：`md:` 的那一条排在 `sm:` 的后面 ✗，所以在 768px 上，
 * `md:` 的那一句赢 ✗。同一个断点上，调用点的那一句赢 ✓（它写在后面 ✓）。
 */
function effectiveKey(stories: Story[], width: string): string | null {
  const limit = rankOf(width)
  let best = -1
  let key: string | null = null
  for (const story of stories) {
    for (const candidate of story.keys()) {
      const at = rankOf(candidate)
      if (at < 0 || at > limit) continue
      if (at <= best) continue
      best = at
      key = candidate
    }
  }
  return key
}

/** 一段故事在某一档屏幕上说的是多少。 */
function heightOf(stories: Story[], width: string): number | null {
  const key = effectiveKey(stories, width)
  if (key === null) return null
  for (let index = stories.length - 1; index >= 0; index -= 1) {
    const story = stories[index]!
    if (story.has(key)) return story.get(key)!
  }
  return null
}

/**
 * 调用点覆盖了共享零件的高度，而那个覆盖没有一路成立。
 *
 * 覆盖从它说"从这一档起"的那一档开始 ✓；从那一档到最宽的那一档 ✓，
 * 生效的都必须是它说的那个高度 ✓。共享的零件在更宽的一档上说的话 ✗，
 * 把它推回去 ✗——那就是**屏幕越宽，那个东西反而越大** ✗。
 */
function brokenOverride(shared: Story, own: Story): string | null {
  if (own.size === 0) return null
  const start = Math.min(...[...own.keys()].map(rankOf))
  for (const width of BREAKPOINTS.slice(start)) {
    const said = heightOf([own], width) ?? heightOf([shared], width)
    const effective = heightOf([shared, own], width)
    if (said === null || effective === null) continue
    if (said === effective) continue
    const at = width || '平常'
    return `在 ${at} 那一档上，共享的零件说的是 ${effective}px，而这里说的是 ${said}px`
  }
  return null
}

/**
 * 一个尺寸档在宽屏上变高了。
 *
 * 一段故事在更宽的屏幕上只许变小或不变 ✓——屏幕越宽，那个东西反而越大 ✗，
 * 读起来是反的 ✗。`wide` 那一档是唯一的例外 ✓。
 */
function growingStep(name: string, story: Story): string | null {
  if (GROWING.has(name)) return null
  let previous: number | null = null
  for (const width of BREAKPOINTS) {
    const height = heightOf([story], width)
    if (height === null) continue
    if (previous !== null && height > previous) {
      return `在 ${width || '平常'} 那一档上从 ${previous}px 变成了 ${height}px`
    }
    previous = height
  }
  return null
}

/** 一个尺寸档在共享的零件里写着什么。 */
function ladderOf(part: string): Map<string, string> {
  const rel = SHARED_PARTS[part]!
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  return source ? variantsOf(source.text) : new Map()
}

/** 一个调用点。 */
interface CallSite {
  rel: string
  line: number
  part: string
  size: string
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of Object.keys(SHARED_PARTS)) {
      const matcher = new RegExp(`<${part}\\b`, 'g')
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        const opening = tagAt(source.text, match.index)
        const attrs = opening.slice(part.length + 1, opening.endsWith('>') ? -1 : undefined)
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          size: /(?:^|\s)size="([^"]*)"/.exec(attrs)?.[1] ?? 'default',
          list: classListOfAttrs(attrs) ?? '',
        })
      }
    }
  }
  return found
}

const CALL_SITES = callSites()

describe('一个高度，一处说了算', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到共享零件的调用点 ✓。
    expect(CALL_SITES.length, '一个共享零件的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(50)

    // 认得出共享零件的每一档 ✓。
    for (const [part, rel] of Object.entries(SHARED_PARTS)) {
      const ladder = ladderOf(part)
      expect(ladder.size, `共享的 ${part} 没有尺寸档，这道门禁多半读错了地方`).toBeGreaterThan(3)
      expect(SOURCES.find((source) => source.rel === rel), `找不到共享的 ${part}`).toBeDefined()
    }

    // **认得出"覆盖被推回去"** ✓——不然这道门禁在空集上跑，永远是绿的 ✓。
    const touch = heightsFrom('h-11 rounded-lg px-5 has-[>svg]:px-4 md:h-9')
    expect(
      brokenOverride(touch, heightsFrom('sm:h-8')),
      '认不出"这里说 32、共享件在 md 上说 36"这一处',
    ).toBeTruthy()
    // 而一路成立的那个 ✓，不该被报出来 ✓。
    expect(
      brokenOverride(heightsFrom('h-9'), heightsFrom('sm:h-7')),
      '把一路成立的那个当成了没成立',
    ).toBeNull()

    // **认得出"这一档在宽屏上变高了"** ✓。
    expect(growingStep('touch', heightsFrom('h-11 md:h-9')), '把没变高的当成了变高的').toBeNull()
    expect(
      growingStep('touch', heightsFrom('h-11 sm:h-8 md:h-9')),
      '认不出"32 之后又变回 36"这一处',
    ).toBeTruthy()
    // `wide` 那一档是唯一的例外 ✓。
    expect(growingStep('wide', heightsFrom('h-9 sm:h-10')), '把 wide 那一档当成了变高的').toBeNull()
  })

  it('凡有覆盖，那个覆盖必须一路成立', () => {
    // 调用点说的"从这一档起是这个高度"，就得从那一档一直成立到最宽的那一档。
    // 共享的零件在更宽的一档上说的话，不许把它推回去。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      const step = ladderOf(site.part).get(site.size) ?? ''
      const broken = brokenOverride(heightsFrom(step), heightsFrom(site.list))
      if (!broken) continue
      offenders.push(`${site.rel}:${site.line}（${site.part} size="${site.size}"）  ${broken}`)
    }

    expect(
      offenders,
      [
        `这些地方覆盖了共享零件的高度，而那个覆盖没有一路成立：${offenders.length} 处`,
        ...offenders,
        '覆盖一旦说了"从这一档起"，就得从那一档一直成立到最宽的那一档：',
        '共享的零件在更宽的一档上说的话，不许把它推回去——否则屏幕越宽，它反而越高。',
      ].join('\n'),
    ).toEqual([])
  })

  it('楼梯自己不许在宽屏上变高', () => {
    const offenders: string[] = []
    for (const [part, rel] of Object.entries(SHARED_PARTS)) {
      for (const [name, list] of ladderOf(part)) {
        const grown = growingStep(name, heightsFrom(list))
        if (!grown) continue
        offenders.push(`${rel}  ${name} 这一档  ${grown}`)
      }
    }

    expect(
      offenders,
      [
        `这些档位在宽屏上变高了：${offenders.length} 处`,
        ...offenders,
        '一个尺寸档在更宽的屏幕上只许变小或不变——屏幕越宽，它反而越大，读起来是反的。',
        '要一个在宽屏上更宽裕的档，就叫 `wide`：它的故事就是那一句话。',
      ].join('\n'),
    ).toEqual([])
  })
})
