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
  'features/navigation/SessionMoreButton.tsx',
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

describe('移动端抽屉：每张都要有入口，入口只能有一个', () => {
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
      /RepoQuickSwitchSheet|NotificationsSheet|SessionMoreButton/,
    )
  })

  /**
   * TopBar renders on every page, so it is the one place a "more" button
   * belongs. The conversation header used to carry a second one opening the
   * same drawer, and on a phone both were on screen at once at two different
   * sizes. A gesture is fine - it is not a second button.
   */
  it('打开同一个抽屉的按钮只有顶栏那一处', () => {
    const buttonCallers = production
      .filter((source) =>
        /<(Button|button)\b[\s\S]{0,400}?onClick=\{\(\) => open\('more'\)\}/.test(source.text),
      )
      .map((source) => source.rel)
    expect(buttonCallers.sort(), `又多了打开抽屉的按钮：${buttonCallers.join(', ')}`).toEqual([
      TOPBAR,
    ])
  })
})
