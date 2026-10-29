import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, stripComments, tagAt } from './source-text'

/**
 * 一个按钮不能有两个高度。
 *
 * 共享的按钮有一道尺寸的属性：它说这个按钮有多高。调用点却又在自己那一串类名
 * 里写了一个高度——于是**两个高度同时存在**，而后写的那个赢：
 *
 * ```
 * <Button size="sm" className="h-6 …" />
 * ```
 *
 * 属性说 32，类名说 24，**24 赢** ✗。共享零件自己写明的那一档，从来没有人
 * 看见过 ✗。
 *
 * 这不是一处两处：全应用有七十多处这样的地方，七十多处两个高度互相矛盾。
 * 而且更怪的是**尺寸和字是交叉的**——`size="sm"` 只改高度不改字，于是"小按钮"
 * 是 32px 高配 14px 的字，被改小过字的那个按钮是 36px 高配 12px 的字。
 *
 * 所以这一轮：
 *
 * - 共享的按钮长出应用真在用的那几档（24、28、44，以及方形的 24、28），
 *   每一档写明自己有多高；
 * - 调用点不再写死高度，要哪一档就说哪一档（`size="xs"`）；
 * - 方形的按钮连宽度一起交给那一档（`size-7` 就是一个 28×28 的方块）。
 *
 * 判的是**形状**：一个按钮的类名里有没有写死高度，共享的那几档各自是多高。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那个按钮。 */
const SHARED_BUTTON = 'components/ui/button.tsx'

/**
 * 共享的按钮每一档尺寸：手机上多高，桌面上多高。
 *
 * 桌面上那一档是空的，意思是两屏一样高。
 */
const LADDER: Record<string, { phone: number; desktop: number | null }> = {
  '2xs': { phone: 24, desktop: null },
  xs: { phone: 28, desktop: null },
  sm: { phone: 32, desktop: null },
  default: { phone: 36, desktop: null },
  lg: { phone: 40, desktop: null },
  // A row in a dialog is roomier on a wide screen.
  wide: { phone: 36, desktop: 40 },
  // A row of touch-sized controls settles back once a mouse is around.
  compact: { phone: 40, desktop: 32 },
  touch: { phone: 44, desktop: 36 },
  'icon-2xs': { phone: 24, desktop: null },
  'icon-xs': { phone: 28, desktop: null },
  'icon-sm': { phone: 32, desktop: null },
  icon: { phone: 36, desktop: null },
  'icon-lg': { phone: 40, desktop: null },
  // A round one. The radius belongs to the size, the way it does for every
  // other step of the ladder - a round key is a shape of the same kind as a
  // small one.
  'icon-circle': { phone: 36, desktop: null },
  'icon-circle-sm': { phone: 28, desktop: null },
  'icon-touch': { phone: 40, desktop: 32 },
}

/** 一串类名里写死的高度（没有断点前缀的那种）。 */
function fixedHeight(list: string): string | null {
  for (const token of list.split(/\s+/)) {
    const match = /^(?:h|size)-(\d+)$/.exec(token)
    if (match) return token
  }
  return null
}

/** 一串类名里，某一档屏幕起才生效的高度。 */
function heightAfter(list: string, breakpoint: string): number | null {
  for (const token of list.split(/\s+/)) {
    const match = new RegExp(`^${breakpoint}:(?:h|size)-(\\d+)$`).exec(token)
    if (match) return Number(match[1])
  }
  return null
}

/**
 * 一串类名里，桌面上有多高。
 *
 * 桌面上生效的是**最后一个够得着的断点** ✗——一档在 `sm:` 上就换了 ✗，
 * 那么 `md:` 上生效的仍然是它 ✗。只认 `md:` 的话 ✗，就会把那种档位
 * 读成"两屏一样高" ✗。
 */
function desktopHeightOf(list: string): number | null {
  const md = heightAfter(list, 'md')
  if (md !== null) return md * 4
  const sm = heightAfter(list, 'sm')
  if (sm !== null) return sm * 4
  return null
}

/** 共享的按钮那一道尺寸的属性，每一档写了什么。 */
function variantsOf(source: string): Map<string, string> {
  const found = new Map<string, string>()
  const at = source.indexOf('size: {')
  if (at < 0) return found
  let depth = 0
  let end = at
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1
    else if (source[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(at, end)
  // 键有时候带引号（`"icon-sm"`），有时候不带（`sm`）。
  for (const match of body.matchAll(/"?([\w-]+)"?:\s*"([^"]*)"/g)) {
    found.set(match[1]!, match[2]!)
  }
  return found
}

/**
 * Tailwind 的步长：`h-6` 是 24px（一步 4px）。
 */
function pixelsOf(token: string | null): number | null {
  if (!token) return null
  const match = /(\d+)$/.exec(token)
  return match ? Number(match[1]) * 4 : null
}

/** 一个按钮的调用点。 */
interface CallSite {
  rel: string
  line: number
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    const matcher = /<Button\b/g
    let match: RegExpExecArray | null
    while ((match = matcher.exec(source.text)) !== null) {
      const opening = tagAt(source.text, match.index)
      const attrs = opening.slice('Button'.length + 1, opening.endsWith('>') ? -1 : undefined)
      found.push({
        rel: source.rel,
        line: source.text.slice(0, match.index).split('\n').length,
        list: classListOfAttrs(attrs) ?? '',
      })
    }
  }
  return found
}

const CALL_SITES = callSites()

describe('一个按钮不能有两个高度', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    const shared = SOURCES.find((source) => source.rel === SHARED_BUTTON)
    expect(shared, '找不到共享的那个按钮').toBeDefined()

    const variants = variantsOf(shared!.text)
    expect(variants.size, '共享的按钮没有尺寸档，这道门禁多半读错了地方').toBeGreaterThan(5)
    for (const name of ['sm', 'default', 'lg', 'icon']) {
      expect([...variants.keys()], `共享的按钮没有 ${name} 这一档`).toContain(name)
    }

    // 找得到调用点。
    expect(CALL_SITES.length, '一个按钮的调用点都没找到').toBeGreaterThan(100)

    // 认得出"写死的高度"和"某一档屏幕起才生效的高度"——这两个不一样。
    expect(fixedHeight('h-6 px-2'), '认不出写死的高度').toBe('h-6')
    expect(fixedHeight('md:h-6 px-2'), '把断点上的高度当成了写死的').toBe(null)
    expect(heightAfter('h-11 sm:h-9', 'sm'), '认不出断点上的高度').toBe(9)
    expect(heightAfter('h-11 sm:h-9', 'md'), '认不出另一档断点的高度').toBe(null)
    // 桌面上生效的是**最后一个够得着的断点**——一档在 `sm:` 上换了，桌面上就是它。
    expect(desktopHeightOf('h-11 sm:h-9'), '认不出在 sm 上换档的那一档').toBe(36)
    expect(desktopHeightOf('h-11 md:h-9'), '认不出在 md 上换档的那一档').toBe(36)
    expect(desktopHeightOf('h-11'), '把没换档的当成了换档的').toBe(null)
  })

  it('共享的按钮写明了每一档有多高', () => {
    const shared = SOURCES.find((source) => source.rel === SHARED_BUTTON)!
    const variants = variantsOf(shared.text)

    const offenders: string[] = []
    for (const [name, expected] of Object.entries(LADDER)) {
      const list = variants.get(name)
      if (!list) {
        offenders.push(`${name}  这一档没有了`)
        continue
      }
      const phone = pixelsOf(fixedHeight(list))
      const desktop = desktopHeightOf(list)
      if (phone !== expected.phone) {
        offenders.push(`${name}  手机上应该是 ${expected.phone}，现在是 ${phone ?? '(没有)'}`)
        continue
      }
      const desktopHeight = desktop === null ? expected.phone : desktop
      if (desktopHeight !== (expected.desktop ?? expected.phone)) {
        offenders.push(
          `${name}  桌面上应该是 ${expected.desktop ?? expected.phone}，现在是 ${desktopHeight}`,
        )
      }
    }

    // 也没有多出来的档。
    for (const name of variants.keys()) {
      if (LADDER[name]) continue
      offenders.push(`${name}  这一档不在那道楼梯上`)
    }

    expect(
      offenders,
      [
        `共享的按钮没有写明自己每一档有多高：${offenders.length} 处`,
        ...offenders,
        '那道楼梯是：24 / 28 / 32 / 36 / 40，手机上的触摸目标是 44。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不再写死按钮的高度', () => {
    // 共享的按钮说它有多高，调用点就不再说第二遍。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      const height = fixedHeight(site.list)
      if (!height) continue
      offenders.push(`${site.rel}:${site.line}  ${height}`)
    }
    expect(
      offenders,
      [
        `这些地方又写了一遍按钮的高度：${offenders.length} 处`,
        ...offenders,
        '按钮有多高是共享按钮的事：调用点要哪一档，就说哪一档（`size="xs"`）。',
      ].join('\n'),
    ).toEqual([])
  })
})
