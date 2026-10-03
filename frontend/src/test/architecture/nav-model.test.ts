import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { buildImportGraph, relativeTo } from './import-graph'
import { buildNavModel, isNavItemActive } from '@/framework/navigation/navModel'
import { BREAKPOINT } from '@/framework/shell/breakpoints'
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

  it('它当时占的那块地也没留下', () => {
    // 底部栏在 4013308 删掉了，浮动按钮那 68px 偏移也跟着收了，可每个页面容器
    // 上的 pb-[calc(env(safe-area-inset-bottom)+56px)] 留了下来：那是栏的高度。
    // 栏没了，那 56px 就成了每个手机页面底部一条什么都看不见、也点不到的白边。
    //
    // 按值判，不按字符串凑。安全区之外多留的那一截取出来，要求不超过普通间距，
    // 于是这条规则对以后新增的页面同样生效。真想恢复底部栏，先改这里。
    const ORDINARY_GAP_PX = 20 // 1.25rem，p-4 那一档

    const reservationPx = (classes: string) => {
      const match = /safe-area-inset-bottom\)\s*\+\s*([\d.]+)(px|rem)/.exec(classes)
      if (!match) return 0
      return Number(match[1]) * (match[2] === 'rem' ? 16 : 1)
    }

    // 规则自己先证明是活的。对着历史上真实存在过的写法试一次：匹配不上就是
    // 正则坏了，而不是"因为没人违规所以通过"的假绿。
    expect(
      reservationPx('pb-[calc(env(safe-area-inset-bottom)+56px)]'),
      '规则连历史上那 56px 都认不出来，多半是正则写坏了',
    ).toBe(56)

    const classLists = SOURCES.flatMap((source) =>
      [...source.text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
        (match) => ({ rel: source.rel, classes: match[1] ?? match[2] ?? '' }),
      ),
    )
    expect(classLists.length, '一条 className 都没扫到，这门禁多半跑在空集上')
      .toBeGreaterThan(500)

    const overBudget = classLists
      .filter((entry) => reservationPx(entry.classes) > ORDINARY_GAP_PX)
      .map((entry) => `${entry.rel}: +${reservationPx(entry.classes)}px`)

    expect(
      [...new Set(overBudget)].sort(),
      '又给已经不存在的底部栏留了空地',
    ).toEqual([])
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

  it('常驻项的个数，是按摊得开的那一档算的', () => {
    // 原来这条是数源码里 `primary: true` 出现了几次，配一句"最多四个"，
    // 理由只有"排得下一行"。那是数字符串，不是断言行为：把 primary 改成
    // 算出来的，它照样数得到几个，而它也不知道到底排不排得下。
    //
    // 现在规则说的是关系：顶栏只在 `spacious` 那一档铺开，常驻项的个数
    // 不得超过那一档排得下的数量（标题 + 仓库切换器上限 256 + More 按钮）。
    // 预算 6 是按六个带文字的入口算的；再加第七个地方就该先量宽度，
    // 而不是让标签被截成 'Assis…'。
    const items = buildNavModel({ isAdmin: true, terminalAllowed: true }).items
    const primaryCount = items.filter((item) => item.primary).length
    const SPREAD_BUDGET = 6

    expect(primaryCount, '能去的地方都该常驻，别在空间够的时候藏进 More').toBe(SPREAD_BUDGET)
    expect(
      primaryCount,
      `顶栏在 spacious 那一档最多排得下 ${SPREAD_BUDGET} 个常驻项；再多就量一下宽度`,
    ).toBeLessThanOrEqual(SPREAD_BUDGET)
    expect(textOf(TOPBAR), '顶栏必须按 spacious 那一档铺开，而不是 expanded').toContain('MEDIA.spaciousUp')
    expect(BREAKPOINT.spacious, 'spacious 必须比 expanded 更宽，否则这一档没有意义')
      .toBeGreaterThan(BREAKPOINT.expanded)
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

  it('入口的顺序是定的，不是推出来的', () => {
    // 顺序没有任何推导依据：Terminal 当初只是因为要按权限条件 push，
    // 就被放到了 Settings 后面，于是它在宽屏上也掉进 More 里。
    // 这是一条产品决定，就该由门禁钉住，而不是等下一次有人改 push 顺序。
    // 终端是两个条件之一成立才有，所以"没有"要把两个条件都关掉，
    // 只关 terminalAllowed 而留着 isAdmin，那一项本来就该在。
    const keys = (isAdmin: boolean, terminalAllowed: boolean) =>
      buildNavModel({ isAdmin, terminalAllowed }).items.map((item) => item.key)

    expect(keys(true, true), '顺序应当是：项目、助手、文件、终端、定时任务、设置、退出')
      .toEqual(['projects', 'assistant', 'files', 'terminal', 'schedules', 'settings', 'logout'])
    expect(keys(true, false), '管理员即使没有 terminal 许可也仍然进得去')
      .toEqual(['projects', 'assistant', 'files', 'terminal', 'schedules', 'settings', 'logout'])
    expect(keys(false, false), '两个条件都不成立时，终端这一项整条消失')
      .toEqual(['projects', 'assistant', 'files', 'schedules', 'settings', 'logout'])
  })

  it('能进的地方就常驻，够宽的时候不许折叠', () => {
    // 每一个"去某个地方"的入口都是 primary。设置和终端曾经不是，
    // 于是空间明明摊得开，它们还是缩在 More 里。
    const items = buildNavModel({ isAdmin: true, terminalAllowed: true }).items
    const places = items.filter((item) => item.to)
    expect(
      places.filter((item) => !item.primary).map((item) => item.key),
      '这些入口空间够的时候也会被折叠进 More',
    ).toEqual([])
  })

  it('进入子页面时，选中的那一项不会掉高亮', () => {
    const active = (pathname: string) =>
      buildNavModel({ isAdmin: true, terminalAllowed: true })
        .items.filter((item) => item.to)
        .filter((item) => isNavItemActive(item, pathname))
        .map((item) => item.key)

    // 项目的排程页和全局排程页是同一个地方
    expect(active('/repos/7/schedules')).toEqual(['schedules'])
    expect(active('/schedules')).toEqual(['schedules'])
    expect(active('/repos/7/assistant')).toEqual(['assistant'])
    expect(active('/files')).toEqual(['files'])
    expect(active('/settings')).toEqual(['settings'])
    expect(active('/terminal')).toEqual(['terminal'])
    // 真正离开之后就不该还亮着
    expect(active('/repos/7/sessions/abc')).toEqual([])
  })
})
