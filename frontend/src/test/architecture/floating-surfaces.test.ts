import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

/**
 * One floating surface.
 *
 * Everything that comes up *over* the page is the same kind of thing: it
 * floats, it is made of the same material, and it casts the same shadow. The
 * repository had three of everything:
 *
 * - **material** - a menu and a dialog were glass, a hint was a solid
 *   `bg-popover`, so a tooltip and the menu beside it were two different
 *   materials;
 * - **shadow** - `shadow-xs` on a card, `shadow-md` on a menu and a hint,
 *   `shadow-lg` on a dialog, and the *sub*menu of a dropdown had `shadow-lg`
 *   while the menu itself had `shadow-md`;
 * - **radius** - a menu 6px, a dialog 8px, a sheet 12px.
 *
 * So the rules are:
 *
 * - a floating surface is **glass** - `bg-surface-glass` and a blur;
 * - it casts the **floating** shadow, `shadow-lg`. The shell's own panels
 *   (the top bar, the window, the status strip) are a tier below at
 *   `shadow-sm`, because they float over the desktop rather than over the
 *   page;
 * - its corner comes from the scale, and the size decides which step: a
 *   small frame (a menu, a hint) is 6px, a large one (a dialog, a sheet, a
 *   drawer) is 12px.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

/**
 * The surfaces that come up over the page, and the corner each one takes.
 *
 * The reason is in the table, because "a small frame is 6px and a large one is
 * 12px" only makes sense next to what is being measured.
 */
const FLOATING_SURFACES: ReadonlyArray<readonly [string, string, string]> = [
  ['components/ui/dialog.tsx', 'sm:rounded-xl', '对话框是一块大面：12px，和外壳浮起的那三块一样'],
  ['components/ui/dropdown-menu.tsx', 'rounded-md', '菜单是小面：6px'],
  ['components/ui/select.tsx', 'rounded-md', '选中框和菜单一样是小面'],
  ['components/ui/tooltip.tsx', 'rounded-md', '提示条和菜单一样是小面'],
  ['components/ui/bottom-sheet.tsx', 'rounded-xl', '底部面板是一块大面'],
  ['components/ui/side-drawer.tsx', 'rounded-xl', '侧边抽屉是一块大面'],
]

/**
 * The surfaces that float over the *desktop* rather than over the page.
 *
 * A full-screen sheet has nothing behind it to float above, so it has no
 * shadow to cast - the same reason a window does not cast one.
 */
const NOT_A_FLOATING_SURFACE: ReadonlyArray<readonly [string, string]> = [
  ['components/ui/fullscreen-sheet.tsx', '整块屏，没有东西在它下面浮'],
]

/** The class lists in a file. */
function classListsOf(text: string): string[] {
  const lists: string[] = []
  for (const match of text.matchAll(/className="([^"]*)"/g)) lists.push(match[1]!)
  for (const match of text.matchAll(/className=\{cn\(([\s\S]*?)\)\}/g)) {
    for (const inner of match[1]!.matchAll(/"([^"]*)"/g)) lists.push(inner[1]!)
    for (const inner of match[1]!.matchAll(/'([^']*)'/g)) lists.push(inner[1]!)
  }
  return lists
}

/** The utility part of a class, with the variants removed. */
function utilityOf(token: string): string {
  const parts = token.split(':')
  return parts[parts.length - 1]!
}

/** Whether a class list carries a class with the given prefix. */
function hasUtility(list: string, prefix: string): boolean {
  return list.split(/\s+/).some((token) => utilityOf(token).startsWith(prefix))
}

/**
 * The class lists that describe something floating over the page.
 *
 * A z-index says "above the page"; a background says "a surface of its own".
 * Both are needed, because a z-index alone is a stacking order and a
 * background alone is a painted box.
 *
 * A list that covers the whole screen is not one of them: that is the scrim
 * that dims the page behind a dialog, or the full-screen form of one. Neither
 * floats over anything - there is nothing behind them to float above.
 */
function floatingSurfaces(text: string): string[] {
  return classListsOf(text).filter(
    (list) =>
      hasUtility(list, 'z-') &&
      hasUtility(list, 'bg-') &&
      !hasUtility(list, 'inset-0'),
  )
}

describe('浮起来的面只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    const sample = 'className="fixed z-50 rounded-lg bg-surface-glass backdrop-blur-lg shadow-lg"'
    expect(
      floatingSurfaces(sample).length,
      '认不出浮起来的面',
    ).toBe(1)
    expect(
      floatingSurfaces('className="flex items-center bg-card border"'),
      '把一个普通盒子当成了浮起来的面',
    ).toHaveLength(0)
    expect(
      floatingSurfaces('className="fixed inset-0 z-70 bg-black/45"'),
      '把压暗页面的那层当成了浮起来的面',
    ).toHaveLength(0)
  })

  it('每一个浮起来的面都是玻璃，投影也是同一档', () => {
    const offenders: string[] = []
    for (const [rel] of FLOATING_SURFACES) {
      const source = SOURCES.find((entry) => entry.rel === rel)
      expect(source, `找不到 ${rel}`).toBeDefined()
      for (const list of floatingSurfaces(source!.text)) {
        const glass = hasUtility(list, 'bg-surface-glass') && hasUtility(list, 'backdrop-blur')
        const shadow = hasUtility(list, 'shadow-lg')
        if (glass && shadow) continue
        offenders.push(`${rel}  ${list.replace(/\s+/g, ' ').trim().slice(0, 90)}`)
      }
    }

    expect(
      offenders,
      [
        `这些浮起来的面不是同一副：${offenders.length} 处`,
        ...offenders,
        '浮起来的面都是玻璃，都投同一档影子（shadow-lg）。',
        '外壳那三块（顶栏、窗口、状态条）是另一档（shadow-sm）——它们浮在桌面上，不在页面上。',
      ].join('\n'),
    ).toEqual([])
  })

  it('每一个面的圆角都是说好的那一档', () => {
    // The corner of the surface itself is the **largest** radius the file
    // uses: the smaller ones belong to the things inside it (a menu item, a
    // close button). Checking that the declared radius is merely *present*
    // would be satisfied by a single leftover mention of it.
    const order = ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']

    for (const [rel, radius, reason] of FLOATING_SURFACES) {
      const source = SOURCES.find((entry) => entry.rel === rel)
      expect(source, `找不到 ${rel}`).toBeDefined()

      const used = new Set<string>()
      for (const match of source!.text.matchAll(/\brounded-(none|sm|md|lg|xl|2xl|3xl)\b/g)) {
        used.add(match[1]!)
      }
      const largest = [...used].sort((left, right) => order.indexOf(right) - order.indexOf(left))[0]

      expect(
        largest,
        `${rel} 的圆角最大的一档是 ${largest}，不是 ${radius}（${reason}）`,
      ).toBe(radius.replace('sm:', '').replace('rounded-', ''))
    }
  })

  it('例外都写明了为什么', () => {
    for (const [rel, reason] of NOT_A_FLOATING_SURFACE) {
      expect(reason.trim().length, `${rel} 没有写为什么可以不算`).toBeGreaterThan(0)
      expect(
        SOURCES.some((source) => source.rel === rel),
        `例外里的 ${rel} 不存在了，这条该删`,
      ).toBe(true)
    }
  })
})
