import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stringLiterals, stripComments, variantsOf } from './source-text'

/**
 * The phone is the same design, not an older one.
 *
 * The palette, the radius scale, the icon weight and the glass arrived
 * everywhere at once - except on the phone, which was still the interface
 * from before any of it. The drawer was a slab painted to the edge of the
 * screen with a square corner and a hard rule under a header that held
 * nothing; the sheet reached the bottom of the display and had a 16px top
 * corner, off the radius scale the whole application is drawn on.
 *
 * So the phone looked like a different product. It is not a different
 * product - it is the same one on a smaller desk - and the geometry has to
 * say so.
 *
 * The rules below are about shape, not about the strings this file has
 * already seen: a panel is a panel because it has a radius and a surface of
 * its own, and it floats because it clears the edge rather than being painted
 * to it.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const sourceOf = (rel: string): string => {
  const found = SOURCES.find((source) => source.rel === rel)
  expect(found, `找不到 ${rel}`).toBeDefined()
  return found!.text
}

/**
 * The surfaces a phone raises, and what kind each one is.
 *
 * A **popup** floats clear of the edge: it is a panel that came up over the
 * page, so it has a gutter and a shadow. A **drawer** used to be a slab
 * painted to the edge of the screen with a square corner and a hard rule
 * under a header that held nothing - the one shape the rest of the
 * application stopped being.
 *
 * An **attached** surface is part of the page it belongs to. The session rail
 * is the left panel of the workspace, and on a phone it slides over the
 * conversation; it keeps the edge it grows out of, and takes a radius on the
 * free corner only. What it still has to share with the popups is the
 * material: glass, a shadow, and a radius off the same scale.
 */
const MOBILE_SURFACES = [
  { rel: 'components/ui/side-drawer.tsx', kind: 'popup' },
  { rel: 'components/ui/bottom-sheet.tsx', kind: 'popup' },
  { rel: 'features/session/SessionRail.tsx', kind: 'attached' },
  { rel: 'features/session/SessionPanel.tsx', kind: 'attached' },
] as const

const MOBILE_OVERLAYS = MOBILE_SURFACES.filter((surface) => surface.kind === 'popup').map((s) => s.rel)

/**
 * The radius scale, as Tailwind names it.
 *
 * A panel that rounds its corners more than the scale does is not on the
 * scale - it is a number somebody typed. The side may be restricted
 * (`rounded-t-xl` is the free corner of a sheet that grows out of the
 * bottom), but the size has to be one of the four steps.
 *
 * `rounded-full` is not on the scale either, and not because it is too big:
 * a pill is a shape rather than a radius.
 */
const SCALE_RADIUS = /^rounded(?:-(?:t|b|l|r|tl|tr|br|bl))?-(?:none|sm|md|lg|xl)$/

/** The utilities that paint a panel to the edge of the screen. */
const PINNED_TO_EDGE = [
  'inset-0',
  'inset-x-0',
  'inset-y-0',
  'top-0',
  'bottom-0',
  'left-0',
  'right-0',
] as const

/** The class lists in a file that look like a class list. */
function classListsOf(text: string): string[] {
  return stringLiterals(text).filter((value) =>
    value.split(/\s+/).some((token) => /^(flex|grid|inline-flex|items-|h-|w-|p[xytrb]?-|m[xytrb]?-|rounded-|bg-|text-|border|gap-|absolute|fixed|relative|min-h-|max-w-)\S*/.test(token)),
  )
}

/** The utility part of a class, with the variants (`hover:`, `md:`) removed. */
function utilityOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1]!
}

/** Whether a class list carries a class with the given prefix. */
function hasUtility(list: string, prefix: string): boolean {
  return list.split(/\s+/).some((token) => utilityOf(token).startsWith(prefix))
}

/**
 * Whether a class list carries this exact utility, variant prefix included.
 *
 * `hasUtility` strips the variant, because most rules are about the shape a
 * utility draws rather than the breakpoint it draws it at. A rule about "on a
 * narrow screen" needs the opposite: the breakpoint is the whole point.
 */
function hasRawUtility(list: string, token: string): boolean {
  return list.split(/\s+/).some((entry) => entry === token)
}

/**
 * The panel of an overlay.
 *
 * A panel is the thing with a radius and a surface of its own. The scrim
 * behind it has a background but no corner, and the sheet's drag handle has
 * a corner but no surface - so asking for both finds the panel and not its
 * neighbours.
 */
function panelOf(text: string): string | undefined {
  return classListsOf(text).find(
    (list) => hasUtility(list, 'rounded-') && hasUtility(list, 'bg-'),
  )
}

/**
 * The corner radii a class list asks for **on a phone**.
 *
 * The variants are the other end of the breakpoint: `md:rounded-none` is what
 * the desktop rail does, and it is not what the phone does. Only the base
 * form is the phone's shape.
 */
function baseRadiiOf(list: string): string[] {
  return list
    .split(/\s+/)
    .filter((token) => !token.includes(':'))
    .filter((token) => utilityOf(token).startsWith('rounded-'))
    .map(utilityOf)
}

/** Whether a class list says where the thing is. */
function hasPosition(list: string): boolean {
  return list.split(/\s+/).some((token) =>
    /^(fixed|absolute|relative|inset|inset-x|inset-y|top|bottom|left|right|mx|my|mt|mb|ml|mr)-/.test(
      utilityOf(token),
    ),
  )
}

/**
 * A Tailwind spacing value in pixels.
 *
 * Tailwind v4 derives the whole scale from one base, `--spacing: 0.25rem`,
 * so `min-h-11` is eleven steps of 4px.
 */
function spacingPx(value: string): number | null {
  if (value === 'px') return 1
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value)
  if (arbitrary) return Number(arbitrary[1])
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric * 4
}

/** The smallest height a class list promises, in pixels. */
function minHeightPx(list: string): number | null {
  let best: number | null = null
  for (const token of list.split(/\s+/)) {
    const utility = utilityOf(token)
    if (!utility.startsWith('min-h-')) continue
    const px = spacingPx(utility.slice(6))
    if (px === null) continue
    if (best === null || px > best) best = px
  }
  return best
}

describe('移动端也是 Plasma', () => {
  it('门禁自己看得见东西', () => {
    // A gate that scans nothing passes vacuously, and one that cannot tell a
    // panel from a scrim decides about the wrong thing.
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    expect(classListsOf('const a = "fixed inset-0 rounded-xl bg-surface-glass"').length).toBe(1)
    expect(panelOf('const a = "fixed inset-0 z-50"')).toBeUndefined()
    expect(
      panelOf('const a = "fixed inset-x-3 rounded-xl border bg-surface-glass shadow-lg"'),
      '认不出浮层面板',
    ).toBeDefined()
    expect(minHeightPx('flex min-h-11 items-center')).toBe(44)
  })

  for (const rel of MOBILE_OVERLAYS) {
    it(`${rel} 是浮起来的，不是贴在边上的板`, () => {
      const panel = panelOf(sourceOf(rel))
      expect(panel, `${rel} 里认不出浮层面板`).toBeDefined()

      // 0. The panel carries its own position. A panel whose placement and
      //    whose looks live in two strings cannot be read against either, so
      //    the rules below would pass on a panel that had been pinned back to
      //    the edge.
      expect(
        hasPosition(panel!),
        `${rel} 的浮面没有把自己的定位写进同一串类名，门禁读不到它`,
      ).toBe(true)

      // 1. It clears the edge. A panel painted to the screen edge is the one
      //    shape the desktop stopped using.
      const pinned = PINNED_TO_EDGE.filter((utility) => hasUtility(panel!, utility))
      expect(
        pinned,
        [
          `${rel} 的浮层还贴在屏幕边上：${pinned.join(' ')}`,
          '手机上的浮层要和桌面上一样浮起来：离边留出沟槽。',
        ].join('\n'),
      ).toEqual([])

      // 2. It has a shadow, because it is above the page rather than part of
      //    it. Without one, a floating panel reads as a hole in the layout.
      expect(
        hasUtility(panel!, 'shadow-'),
        `${rel} 浮起来了却没有影子，读起来像布局上的一个洞`,
      ).toBe(true)

      // 3. It is glass, like every other floating surface in the application.
      expect(
        hasUtility(panel!, 'bg-surface-glass') && hasUtility(panel!, 'backdrop-blur'),
        `${rel} 的浮层不是玻璃，和其它浮层不是一套东西`,
      ).toBe(true)

      // 4. Its corner is on the radius scale. A number somebody typed is not
      //    a radius the design has.
      const radii = baseRadiiOf(panel!)
      expect(radii.length, `${rel} 的浮层没有圆角`).toBeGreaterThan(0)
      const offScale = radii.filter((radius) => !SCALE_RADIUS.test(radius))
      expect(
        offScale,
        [
          `${rel} 的浮层用了刻度之外的圆角：${offScale.join(' ')}`,
          '刻度是 sm/md/lg/xl 四级，最大 12px。',
        ].join('\n'),
      ).toEqual([])
    })
  }

  it('手机上的浮层文件里没有刻度之外的圆角', () => {
    const offenders: string[] = []
    for (const rel of MOBILE_SURFACES.map((surface) => surface.rel)) {
      const text = sourceOf(rel)
      // `rounded-full` is not on this list: a pill is a shape, and the sheet's
      // drag handle is one. A number *bigger* than the scale is a different
      // mistake - somebody typed it.
      for (const match of text.matchAll(/\brounded-(?:2xl|3xl)\b/g)) {
        offenders.push(`${rel}: ${match[0]}`)
      }
    }
    expect(
      offenders,
      [
        '这些圆角不在刻度上：',
        ...offenders,
        '刻度是 sm/md/lg/xl 四级，最大 12px。',
      ].join('\n'),
    ).toEqual([])
  })

  it('每一个手机上的浮面都是同一套材质', () => {
    for (const surface of MOBILE_SURFACES) {
      const panel = panelOf(sourceOf(surface.rel))
      expect(panel, `${surface.rel} 里认不出浮面`).toBeDefined()

      // Glass, like every other floating surface in the application.
      expect(
        hasUtility(panel!, 'bg-surface-glass') && hasUtility(panel!, 'backdrop-blur'),
        `${surface.rel} 的浮面不是玻璃，和其它浮面不是一套东西`,
      ).toBe(true)

      // A shadow, because it is above the page rather than part of it.
      expect(
        hasUtility(panel!, 'shadow-'),
        `${surface.rel} 浮起来了却没有影子，读起来像布局上的一个洞`,
      ).toBe(true)

      // A corner off the scale. A number somebody typed is not a radius the
      // design has.
      const radii = baseRadiiOf(panel!)
      expect(radii.length, `${surface.rel} 的浮面没有圆角`).toBeGreaterThan(0)
      const offScale = radii.filter((radius) => !SCALE_RADIUS.test(radius))
      expect(
        offScale,
        [
          `${surface.rel} 的浮面用了刻度之外的圆角：${offScale.join(' ')}`,
          '刻度是 sm/md/lg/xl 四级，最大 12px。',
        ].join('\n'),
      ).toEqual([])
    }
  })

  it('手机上不重复说一遍项目名', () => {
    // The shell's project switcher names the project you are in. On a phone
    // the two headers are stacked, so a page that repeated the name said it
    // twice within sixty pixels - and the repeat sat close enough to the
    // title to be read as part of it.
    //
    // The decision lives in the header component (`subtitleRepeatsProject`),
    // so the rule is checked where it is made: the call site has to say that
    // the subtitle is a repeat, or the header cannot know to drop it.
    const sessionDetail = sourceOf('pages/SessionDetail.tsx')
    expect(
      /subtitleRepeatsProject/.test(sessionDetail),
      '会话页没有告诉标题栏"这个副标题是重复的项目名"，手机上就会说两遍',
    ).toBe(true)
  })

  it('窄屏上页面标题栏不再画自己那条线', () => {
    // The rule under the page header is the *window's* separator on a
    // desktop. On a phone the header is not a window's title bar: it sits
    // directly under the shell's bar, which already draws a rule, and two
    // rules sixty pixels apart read as two toolbars.
    const header = classListsOf(sourceOf('components/ui/page-header.tsx'))
      .find((list) => hasUtility(list, 'sticky'))
    expect(header, '认不出页面标题栏').toBeDefined()

    expect(
      hasRawUtility(header!, 'max-sm:border-b-0'),
      '页面标题栏在窄屏上仍然画着那条线：手机上会变成两条工具栏',
    ).toBe(true)
  })

  it('标题在手机上不会比在桌面上更小', () => {
    // The title of a page is the same sentence on both, so it is the same
    // size. It used to be `text-xs sm:text-base` - the phone got a 12px
    // title and the desktop a 16px one, which is the wrong way round.
    const sizes: Record<string, number> = {
      'text-xs': 12,
      'text-sm': 14,
      'text-base': 16,
      'text-lg': 18,
      'text-xl': 20,
      'text-2xl': 24,
    }

    const offenders: string[] = []
    for (const rel of ['components/ui/header.tsx', 'components/ui/page-header.tsx']) {
      for (const list of classListsOf(sourceOf(rel))) {
        const base = list.split(/\s+/).find((token) => sizes[utilityOf(token)] !== undefined)
        const wide = list.split(/\s+/).find((token) => token.startsWith('sm:') && sizes[utilityOf(token)] !== undefined)
        if (!base || !wide) continue
        if (sizes[utilityOf(base)]! < sizes[utilityOf(wide)]!) {
          offenders.push(`${rel}: ${list}`)
        }
      }
    }

    expect(
      offenders,
      [
        '这些标题在手机上比在桌面上更小：',
        ...offenders,
        '同一句话在两种屏幕上应当一样大——手机上更小的是反过来的。',
      ].join('\n'),
    ).toEqual([])
  })

  it('手机上的入口是够得着的', () => {
    // A finger is not a cursor. The drawer's entries are the phone's whole
    // navigation, so they have to be big enough to hit - 44px is the number
    // every platform agrees on.
    //
    // 那些入口**是共享的行零件** ✓ —— 够不够得着 ✓ 是**那一档**说了算 ✓，
    // 不再是**每个调用点自己写** ✓。
    const text = sourceOf('features/navigation/MoreDrawer.tsx')
    const entries = [...text.matchAll(/<Row\b([^>]*)>/g)]
    expect(entries.length, '没认出抽屉里的入口').toBeGreaterThan(0)

    const sizes = variantsOf(sourceOf('components/ui/row.tsx'), 'size')
    const used = new Set(
      entries
        .map((entry) => /size="([^"]*)"/.exec(entry[1] ?? '')?.[1])
        .filter((step): step is string => Boolean(step)),
    )
    expect(used.size, '抽屉里的入口没有说自己是哪一档').toBeGreaterThan(0)

    for (const step of used) {
      const list = sizes.get(step)
      expect(list, `共享的行零件没有 ${step} 那一档`).toBeDefined()
      const height = minHeightPx(list!)
      expect(
        height,
        [
          `抽屉里的入口没有声明最小高度：${step}`,
          '手指不是指针——入口至少要 44px 高。',
        ].join('\n'),
      ).not.toBeNull()
      expect(height!, '抽屉里的入口不够手指点').toBeGreaterThanOrEqual(44)
    }
  })
})
