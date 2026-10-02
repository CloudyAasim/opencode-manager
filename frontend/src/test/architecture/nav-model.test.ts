import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildImportGraph, relativeTo } from './import-graph'
import path from 'node:path'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({ rel: relativeTo(graph, file), text: fs.readFileSync(file, 'utf8') }))
const textOf = (rel: string) => SOURCES.find((source) => source.rel === rel)!.text

// 谁依赖了这个模块。这是真的依赖关系，不是"看起来像 import 的字符串"，
// 所以换个别名写法或者相对路径，门禁不会跟着瞎。
const importersOf = (rel: string) =>
  graph.edges
    .filter((edge) => relativeTo(graph, edge.to) === rel)
    .map((edge) => relativeTo(graph, edge.from))
    .sort()

const MODEL = 'framework/navigation/navModel.ts'
const TOPBAR = 'framework/shell/TopBar.tsx'
const FRAME = 'framework/shell/ShellFrame.tsx'
const APP = 'App.tsx'
const SHELL_HOST = 'features/navigation/MobileSheetHost.tsx'
const MORE_DRAWER = 'features/navigation/MoreDrawer.tsx'

// 导航曾经有三张脸：左侧栏、底部栏、一个抽屉，每张脸各自抄了一份项表，
// 各自猜"我现在在哪"。现在只剩顶栏一张脸，手机端它收进抽屉。
// 这个门禁守的是"唯一"两个字：谁有资格渲染导航、谁有资格把它挂起来、
// 常驻的那几条由谁决定。想加第三张脸就得改这里，这正是它该有的阻力。
const NAV_SURFACES = [MORE_DRAWER, TOPBAR]

describe('导航只有顶栏一张脸', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
    for (const rel of [MODEL, TOPBAR, FRAME, APP, SHELL_HOST, MORE_DRAWER]) {
      expect(SOURCES.some((source) => source.rel === rel), `找不到 ${rel}`).toBe(true)
    }
    expect(importersOf(MODEL).length, '模型没人消费，它就是死代码').toBeGreaterThanOrEqual(2)
  })

  it('外壳不再留导航槽', () => {
    const body = /interface ShellFrameProps \{([\s\S]*?)\n\}/.exec(textOf(FRAME))?.[1] ?? ''
    expect(body, '读不出 ShellFrameProps').not.toBe('')
    const props = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1])
    const slots = props.filter((prop) => /rail|sidebar|bottom|footer|nav|tab/i.test(prop))
    expect(slots, `外壳又留了导航槽：${slots.join(', ')}`).toEqual([])
    expect(textOf(APP), 'App 还在往已经不存在的槽里塞东西').not.toMatch(/^\s*(rail|bottom)=\{/m)
  })

  it('旧的两种形态已经从磁盘上消失', () => {
    const onDisk = new Set(SOURCES.map((source) => source.rel))
    for (const gone of ['features/navigation/DesktopSidebar.tsx', 'features/navigation/MobileTabBar.tsx']) {
      expect(onDisk.has(gone), `${gone} 又回来了`).toBe(false)
    }
    const all = SOURCES.map((source) => source.text).join('\n')
    expect(all, '还有人引用已删的导航组件').not.toMatch(/DesktopSidebar|MobileTabBar/)
  })

  it('渲染导航的只有顶栏和它的手机端抽屉', () => {
    const consumers = importersOf(MODEL)
    expect(consumers, `能渲染导航的文件多了一个：${consumers.join(', ')}`).toEqual(NAV_SURFACES)
  })

  it('顶栏是唯一常驻的那张脸，手机端抽屉不常驻', () => {
    const hosts = importersOf(TOPBAR)
    expect(hosts, `顶栏被挂了不止一次：${hosts.join(', ')}`).toEqual([APP])
    // 抽屉只在弹层宿主里被拉起来，宿主按 URL 参数决定开不开，
    // 所以它不会变成第二根常驻的导航条。
    expect(importersOf(MORE_DRAWER), `抽屉被别处直接挂载了`).toEqual([SHELL_HOST])
  })

  it('常驻项和高亮都由模型给出，宿主不自己解析路由', () => {
    const bar = textOf(TOPBAR)
    expect(bar, '顶栏的高亮必须来自模型').toContain('isNavItemActive')
    // 注意这里要认的是"没有取反的 primary 过滤"。只写 toContain('item.primary')
    // 会被 overflow 那行的 !item.primary 顶下来，看着有规则其实没在管。
    expect(
      bar,
      '常驻的那几条应当是模型里 primary 的那批，而不是顶栏自己挑的',
    ).toMatch(/filter\(\s*\(?\s*item\s*\)?\s*=>\s*item\.primary\s*\)/)
    expect(
      bar,
      '顶栏开始自己抄项表了：宿主只负责渲染，不负责定义',
    ).not.toMatch(/\bkey:\s*'|\bto:\s*'\/|\bdialog:\s*'/)
    expect(
      bar,
      '顶栏又在拿路由猜哪些项该露出来',
    ).not.toMatch(/match\(\s*location\.pathname|pathname\.match\(|pathname\.startsWith\(|location\.pathname\s*===/)
    expect(textOf(MODEL), '高亮规则应当由模型给出').toContain('export function isNavItemActive')
  })

  it('常驻项不超五个，窄屏也排得下一行', () => {
    const primaryCount = (textOf(MODEL).match(/primary: true/g) ?? []).length
    expect(primaryCount).toBeGreaterThanOrEqual(3)
    expect(primaryCount, '顶栏最多四个常驻项，其余进 More').toBeLessThanOrEqual(4)
  })

  it('没有第二个悬浮入口和 More 抢同一个动作', () => {
    // 按 class 逐个判，不按行去凑。原先那条 fixed bottom-[...] 的写法在整个
    // 代码库里匹配到 0 个，是一条永远为真的规则——它从来没在管过任何东西。
    const isFloatingNudge = (classes: string) =>
      /(^|\s)fixed(\s|$)/.test(classes) &&
      /(^|\s)bottom-/.test(classes) &&
      /(^|\s)rounded-(full|3xl|2xl|xl)(\s|$)/.test(classes)
    const floating = SOURCES.filter((source) =>
      [...source.text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].some((match) =>
        isFloatingNudge(match[1] ?? match[2] ?? ''),
      ),
    ).map((source) => source.rel)
    expect(
      floating,
      `这些地方还有悬浮按钮，而顶栏已经有 More：${floating.join(', ')}`,
    ).toEqual([])
  })
})
