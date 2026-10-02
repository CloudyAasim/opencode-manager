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

const MODEL = 'features/navigation/moreDrawerItems.ts'
const BAR = 'features/navigation/MobileTabBar.tsx'
const RAIL = 'features/navigation/DesktopSidebar.tsx'

// A bottom bar earns its space by being always visible. Once it hides itself on
// some routes, we are back to the old arrangement where a new route could make
// it vanish without a word - which is the thing the first one got wrong.
const VISIBILITY_ROUTES = /match\(\s*location\.pathname|getMobileTabRouteState|pathname\.match\(/

describe('导航只有一份模型', () => {
  it('门禁看得见模型和它的两个消费方', () => {
    for (const rel of [MODEL, BAR, RAIL]) {
      expect(SOURCES.some((source) => source.rel === rel), `找不到 ${rel}`).toBe(true)
    }
  })

  it('底部栏不靠匹配路由决定自己出不出现', () => {
    const bar = SOURCES.find((source) => source.rel === BAR)!.text
    expect(bar, '底部栏又在解析路由来决定显隐').not.toMatch(VISIBILITY_ROUTES)
    expect(bar, '底部栏应当由导航模型给出常驻项').toContain('item.primary')
  })

  it('两侧都从同一份模型取项', () => {
    const model = SOURCES.find((source) => source.rel === MODEL)!.text
    const bar = SOURCES.find((source) => source.rel === BAR)!.text
    const rail = SOURCES.find((source) => source.rel === RAIL)!.text
    expect(bar).toContain('buildNavModel')
    expect(rail).toContain('buildNavModel')
    // and the highlight comes from the model, not from a switch next door
    expect(rail, '左侧栏还在自己判断高亮').toContain('isNavItemActive')
    expect(model).toContain('export function isNavItemActive')
  })

  it('常驻项不超五个，够得着拇指也放得下', () => {
    const model = SOURCES.find((source) => source.rel === MODEL)!.text
    const primaryCount = (model.match(/primary: true/g) ?? []).length
    expect(primaryCount).toBeGreaterThanOrEqual(3)
    expect(primaryCount, '底部栏最多五个主入口，其余进 More').toBeLessThanOrEqual(4)
  })

  it('没有第二个悬浮入口和底部栏抢同一个动作', () => {
    const floating = SOURCES.filter(
      (source) => source.rel !== BAR && /fixed bottom-\[[^\]]*\][^\n]*rounded-full/.test(source.text),
    ).map((source) => source.rel)
    expect(
      floating,
      `这些地方还有悬浮按钮，而底部栏已经有 More：${floating.join(', ')}`,
    ).toEqual([])
  })
})
