import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

const HOOK = 'hooks/useMobileSheets.ts'
const HOST = 'features/navigation/MobileSheetHost.tsx'
const TOPBAR = 'framework/shell/TopBar.tsx'

const isTest = (rel: string) => rel.includes('.test.')
const production = SOURCES.filter((source) => !isTest(source.rel))

// The sheets that used to be mounted here for keys nothing ever set. They had
// no producer at all - a drawer with no button that opens it is a screen a
// user cannot reach and cannot come back from.
const UNREACHABLE = [
  'features/navigation/RepoQuickSwitchSheet.tsx',
  'features/navigation/NotificationsSheet.tsx',
]

/**
 * MobileSheetKey is the list of drawers this app claims to have. It used to
 * name four, three of which no button could open. The type is where that goes
 * wrong: adding a member costs nothing and looks deliberate.
 */
function declaredKeys(): string[] {
  const source = SOURCES.find((entry) => entry.rel === HOOK)
  const declaration = /type MobileSheetKey =([\s\S]*?)\n/.exec(source!.text)?.[1]
  if (!declaration) return []
  return [...declaration.matchAll(/'([a-z]+)'/g)].map((match) => match[1]!)
}

/** Only files that actually import the hook can call its `open`. */
function openerFiles() {
  return graph.edges
    .filter((edge) => relativeTo(graph, edge.to) === HOOK)
    .map((edge) => relativeTo(graph, edge.from))
    .filter((rel) => !isTest(rel))
}

describe('移动端抽屉：每张都要有入口，入口不能无限膨胀', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
    for (const rel of [HOOK, HOST, TOPBAR]) {
      expect(SOURCES.some((source) => source.rel === rel), `找不到 ${rel}`).toBe(true)
    }
    expect(openerFiles().length, '没有生产代码调用过这个 hook，它本身就是死的').toBeGreaterThan(0)
    expect(declaredKeys().length, '读不出 MobileSheetKey 的成员').toBeGreaterThan(0)
  })

  it('声明出来的每一张 sheet 都有生产代码里的入口', () => {
    const keys = declaredKeys()
    const openers = openerFiles()
    const opened = new Set<string>()
    for (const rel of openers) {
      const text = SOURCES.find((source) => source.rel === rel)!.text
      // `window.open` and `caches.open` are not this hook's open().
      for (const match of text.matchAll(/(?<![\w.])open\(\s*'([a-z]+)'\s*\)/g)) {
        opened.add(match[1]!)
      }
    }
    const orphans = keys.filter((key) => !opened.has(key))
    expect(orphans, `声明了却没有任何按钮能打开的抽屉：${orphans.join(', ')}`).toEqual([])
  })

  it('没有入口的那些组件已经从磁盘上消失', () => {
    const onDisk = new Set(SOURCES.map((source) => source.rel))
    for (const gone of UNREACHABLE) {
      expect(onDisk.has(gone), `${gone} 又回来了`).toBe(false)
    }
    const all = SOURCES.map((source) => source.text).join('\n')
    expect(all, '还有文件引用已删的组件').not.toMatch(
      /RepoQuickSwitchSheet|NotificationsSheet/,
    )
  })

  /**
   * This gate used to demand exactly one button that opens the drawer, on the
   * reasoning that TopBar renders everywhere and a second entry is a duplicate.
   * Upstream says otherwise: every screen carries its own More and a bottom tab
   * bar sits underneath, so on a phone the in-context one stays on screen once
   * you have scrolled down a long thread. This fork has no tab bar - the 56px
   * of reserved bottom padding is the hole where one used to be - so deleting
   * the conversation header's button left a phone user with no way out of a
   * long conversation except the bar at the very top.
   *
   * The rule that survives: two entry points, never three.
   */
  it('打开同一个抽屉的按钮不多不少', () => {
    const buttonCallers = production
      .filter((source) =>
        /<(Button|button)\b[\s\S]{0,400}?onClick=\{\(\) => open\('more'\)\}/.test(source.text),
      )
      .map((source) => source.rel)
      .sort()

    expect(buttonCallers, `抽屉入口变成了 ${buttonCallers.join(', ')}`).toContain(TOPBAR)
    expect(buttonCallers.length, '抽屉入口在膨胀').toBeLessThanOrEqual(2)
    // The button is defined in its own component and mounted by SessionDetail,
    // so the caller looks for the file that actually owns the click handler.
    expect(
      buttonCallers.some((rel) => rel.endsWith('navigation/SessionMoreButton.tsx')),
      '会话页没有自己的抽屉入口了，手机上滚长了就出不去了',
    ).toBe(true)
  })
})
