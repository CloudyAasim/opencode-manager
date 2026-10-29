import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, ownListOf, recordOf, stripComments, tagAt, variantsOf } from './source-text'

/**
 * 共享零件的脸，各有各副。
 *
 * 徽章和警告也有一道**档**（variant ✓）——徽章四副 ✓（`default` ✓、`secondary` ✓、
 * `destructive` ✓、`outline` ✓），警告两副 ✓（`default` ✓、`destructive` ✓）。
 *
 * 可是**没有"成功"和"警告"这两副** ✗——于是想要一个绿色的徽章 ✗，
 * 就在调用点上自己写 `bg-success` ✗；想要一个警告色的 ✗，就自己写 `border-warning` ✗。
 * 十五个地方 ✗，每一种还都写着**不止一种写法** ✗（绿的有白字 ✗、有绿图标 ✗）。
 *
 * 而且其中两种**看不见** ✗：
 *
 * - 一个绿色的徽章写 `bg-success text-success` ✗——`bg-success` 是 `#27ae60` ✗，
 *   `text-success` **也是** `#27ae60` ✗：**字和它自己的底一个颜色** ✗。
 * - 一个提示框写 `border-primary bg-primary` ✗——底下是主色 ✗，
 *   字却还是页面的颜色 ✗。
 *
 * **卡片**也是 ✗：它本来只有一副脸 ✗，而"别的样子" ✗——嵌在面板里的 ✓、
 * 空着的 ✓、推后一步的 ✓、只是个框的 ✓——**每一句都被说了好几遍** ✗
 * （不要边不要影 ✗ 说了八遍 ✗，虚线边 ✗ 说了六遍 ✗）。
 *
 * 所以这一轮：
 *
 * - **它们有了名字** ✓：徽章多了 `success` ✓、`warning` ✓、`outline-warning` ✓，
 *   警告多了 `success` ✓、`primary` ✓，卡片多了 `flat` ✓、`dashed` ✓、
 *   `muted` ✓、`transparent` ✓——和尺寸的那道楼梯一样 ✓，
 *   每一副写明自己的脸 ✓。
 * - **一副脸里，字和底不许是同一个颜色** ✓。
 * - **调用点不许自己写脸** ✓（和按钮 ✗、字段 ✗ 一样 ✓）。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 这一轮管的那几个零件 ✓，和它们各自的文件 ✓。 */
const PARTS: Record<string, string> = {
  Badge: 'components/ui/badge.tsx',
  Alert: 'components/ui/alert.tsx',
  Card: 'components/ui/card.tsx',
  TabsList: 'components/ui/tabs.tsx',
  TabsTrigger: 'components/ui/tabs.tsx',
  DialogFooter: 'components/ui/dialog.tsx',
  DialogContent: 'components/ui/dialog.tsx',
  FormItem: 'components/ui/form.tsx',
  Row: 'components/ui/row.tsx',
}

/**
 * 有些文件里**不止一副档** ✓——按声明名挑 ✓。
 *
 * 不挑的话 ✗，门禁读到的是**第一个** ✗（页签条 ✓ 而不是页签 ✗），
 * 于是"不许重复"那条 ✗ 用错了档 ✗。
 */
const DECLARATION: Record<string, string> = {
  TabsTrigger: 'tabsTriggerVariants',
  DialogFooter: 'dialogFooterVariants',
  DialogContent: 'dialogContentVariants',
  FormItem: 'formItemVariants',
  Row: 'rowVariants',
}

/** 所有的"有档的"零件 ✓——颜色那一道规矩管的是全部 ✓。 */
const WITH_VARIANTS: Record<string, string> = {
  ...PARTS,
  Button: 'components/ui/button.tsx',
}

/**
 * 脸上那几类 ✓。
 *
 * **没有前缀的** ✓才是脸本身 ✓——带前缀的那一句 ✗ 是**状态** ✗
 * （`hover:bg-muted` ✓ 是悬停时变灰 ✓），不是另一张脸 ✗。
 */
const FACE_TOKEN = /^(?:rounded|bg|border|shadow)(?:-|$)/

/**
 * **哪一边**的那些 ✗ 是在改**形状** ✓，不是另一张脸 ✗。
 */
const SHAPE_TOKEN = /^(?:rounded|border)-(?:[lrtybxy]{1,2})(?:-|$)/

/**
 * 弹窗**有多宽** ✓。
 *
 * 凡是 `w-` ✓ 都算 ✓——`w-[90%]` ✓、`w-[calc(100vw-2rem)]` ✓ 都是"占屏幕多宽" ✓。
 */
const A_WIDTH = /^(?:[a-z0-9]+:)?(?:max-)?w-/

/**
 * 弹窗**有多高** ✓。
 *
 * 只有**说到视口单位**的 ✓ 才算 ✓（`vh` ✓、`dvh` ✓、`svh` ✓、`lvh` ✓）——
 * `h-auto` ✓（随内容 ✓）、`h-fit` ✓（贴着内容 ✓）、`h-4` ✓（固定几个格子 ✓）
 * 都不是"在屏幕上占多高" ✓。
 */
const A_HEIGHT = /^(?:[a-z0-9]+:)?(?:max-)?h-.*vh/

/**
 * **满屏**的那些说法 ✓：它们是同一个决定 ✓，不是刻度上的某一档 ✓。
 */
const FULL_SCREEN = ['w-full', 'max-w-none', 'w-screen', 'h-dvh', 'max-h-dvh']

/** 每一副说了什么 ✓。 */
function variantsOfPart(part: string): Map<string, string> {
  const rel = PARTS[part]
  if (!rel) return new Map()
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  return source ? variantsOf(source.text, 'variant', DECLARATION[part]) : new Map()
}

/**
 * 共享零件自己说的那道刻度 ✓。
 *
 * 宽 ✓ 和高 ✓ 都不是脸 ✓，而是尺寸 ✓——它们写在一张表里 ✓，
 * 不是写在 `cva` 的某一副里 ✓。
 */
function scaleOf(declaration: string): Map<string, string> {
  const source = SOURCES.find((candidate) => candidate.rel === PARTS.DialogContent)
  return source ? recordOf(source.text, declaration) : new Map()
}

/** 那一档说过的每一个词 ✓。 */
function saidBy(variants: Map<string, string>, variant: string): Set<string> {
  const words = new Set<string>()
  for (const token of (variants.get(variant) ?? '').split(/\s+/)) {
    if (token) words.add(token)
  }
  return words
}

/**
 * 被点名的一次性例外 ✓。
 *
 * 每一处都写清楚三件事 ✓：**是哪个零件** ✓、**哪一句** ✓、
 * 以及**为什么它不一样** ✓。
 *
 * 而且**一个例外只放过一处** ✓：同一处不许写两遍 ✓；
 * 同一句在同一文件里也不许盖住两个地方 ✓——
 * 那说明它不是一次性的例外 ✓，而是**又该长出一副脸** ✓。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string, string]> = [
  [
    'components/ui/error-banner.tsx',
    'Alert',
    'bg-card',
    '错误横幅是**一张卡片** ✗，不是普通警告 ✗',
  ],
  [
    'components/ui/error-banner.tsx',
    'Alert',
    'border-border',
    '错误横幅是**一张卡片** ✗，不是普通警告 ✗',
  ],
  [
    'features/source-control/CommitsTab.tsx',
    'Row',
    'border-border',
    '这一行的**分隔线** ✓ 是**那一列**的事 ✓，不是行自己的脸 ✓',
  ],
  [
    'features/session/SessionCard.tsx',
    'Card',
    'rounded-none',
    '这一张**开着** ✗，它没有圆角 ✓',
  ],
  [
    'features/settings/SettingsDialog.tsx',
    'TabsList',
    'border-border',
    '设置那边的页签是**竖着的一列** ✗，它自己带着一道边 ✓',
  ],
  [
    'features/settings/SettingsDialog.tsx',
    'TabsList',
    'rounded-none',
    '设置那边的页签是**竖着的一列** ✗，它没有圆角 ✓',
  ],
  [
    'features/settings/SettingsDialog.tsx',
    'DialogContent',
    'rounded-none',
    '这一个弹窗**通栏** ✗，它没有圆角 ✓',
  ],
  [
    'components/ui/EditSessionTitleDialog.tsx',
    'DialogContent',
    'rounded-none',
    '这个弹窗**通栏** ✗，它没有圆角 ✓',
  ],
  [
    'components/ui/EditSessionTitleDialog.tsx',
    'DialogContent',
    'border-0',
    '这个弹窗**通栏** ✗，它不要边 ✓',
  ],
  [
    'features/settings/OpenCodeModelDialog.tsx',
    'FormItem',
    'shadow-sm',
    '这一个盒子**多一道影** ✗',
  ],
  [
    'components/ui/confirm-destructive-dialog.tsx',
    'DialogContent',
    'max-w-[90%]',
    '这一个弹窗**九成宽** ✗，比默认的那一副宽 ✗',
  ],
  [
    'features/settings/RestartServerDialog.tsx',
    'DialogContent',
    'max-w-[90%]',
    '这一个弹窗**九成宽** ✗，比默认的那一副宽 ✗',
  ],
  [
    'features/settings/UsersSettings.tsx',
    'DialogContent',
    'max-w-[90%]',
    '这一个弹窗**九成宽** ✗，比默认的那一副宽 ✗',
  ],
  [
    'features/session/PermissionRequestDialog.tsx',
    'DialogContent',
    'max-w-[calc(100vw-2rem)]',
    '这一个弹窗**离屏幕边两格** ✗，两边对称 ✗',
  ],
  [
    'features/ssh/SSHHostKeyDialog.tsx',
    'DialogContent',
    'max-w-[calc(100vw-2rem)]',
    '这一个弹窗**离屏幕边两格** ✗，两边对称 ✗',
  ],
  [
    'features/settings/McpOAuthDialog.tsx',
    'DialogContent',
    'w-[calc(100vw-2rem)]',
    '这一个弹窗**离屏幕边两格** ✗，两边对称 ✗',
  ],
  [
    'features/schedules/PromptTemplateDialog.tsx',
    'DialogContent',
    'w-[calc(100vw-1rem)]',
    '这一个弹窗**几乎满屏** ✗',
  ],
  [
    'features/schedules/ScheduleJobDialog.tsx',
    'DialogContent',
    'sm:max-w-[90vw]',
    '这一个弹窗**几乎满屏** ✗',
  ],
  [
    'features/schedules/ScheduleJobDialog.tsx',
    'DialogContent',
    'sm:w-[calc(100vw-1rem)]',
    '这一个弹窗**几乎满屏** ✗',
  ],
  [
    'features/source-control/SourceControlPanel.tsx',
    'DialogContent',
    'w-[90vw]',
    '这一个弹窗**九成视口宽** ✗',
  ],
  [
    'components/ui/download-dialog.tsx',
    'DialogContent',
    'max-h-[80vh]',
    '这一个弹窗在**所有屏幕**上都限八成高 ✗，不是只有宽屏 ✗',
  ],
  [
    'pages/SessionDetail.tsx',
    'DialogContent',
    'max-h-[80vh]',
    '这一个弹窗在**所有屏幕**上都限八成高 ✗，不是只有宽屏 ✗',
  ],
  [
    'features/schedules/PromptTemplateDialog.tsx',
    'DialogContent',
    'max-h-[calc(100dvh-1rem)]',
    '这一个弹窗**比视口矮一格** ✗',
  ],
  [
    'features/schedules/PromptTemplateDialog.tsx',
    'DialogContent',
    'sm:max-h-[90vh]',
    '这一个弹窗**九成屏幕高** ✗',
  ],
  [
    'features/schedules/PromptTemplateDialog.tsx',
    'DialogContent',
    'h-[calc(100dvh-1rem)]',
    '这一个弹窗**在手机上正好比视口矮一格** ✗',
  ],
  [
    'features/settings/GitCredentialDialog.tsx',
    'DialogContent',
    'h-[90vh]',
    '这一个弹窗**在手机上正好九成高** ✗',
  ],
  [
    'features/source-control/SourceControlPanel.tsx',
    'DialogContent',
    'h-[90vh]',
    '这一个弹窗**九成视口高** ✗',
  ],
  [
    'features/schedules/ScheduleJobDialog.tsx',
    'DialogContent',
    'sm:h-[min(85vh,760px)]',
    '这一个弹窗**在宽屏上最高不超过 760px** ✗，屏幕再大也不长高 ✓',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, part: string, token: string): boolean {
  return EXCEPTIONS.some(
    ([file, markedPart, marked]) =>
      file === rel && markedPart === part && marked === token,
  )
}

interface CallSite {
  rel: string
  line: number
  part: string
  variant: string
  width: string
  height: string
  list: string
}

function callSites(parts: Record<string, string>): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of Object.keys(parts)) {
      const matcher = new RegExp(`<${part}\\b`, 'g')
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        const opening = tagAt(source.text, match.index)
        const attrs = opening.slice(part.length + 1, opening.endsWith('>') ? -1 : undefined)
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          variant: /(?:^|\s)variant="([^"]*)"/.exec(attrs)?.[1] ?? 'default',
          width: /(?:^|\s)width="([^"]*)"/.exec(attrs)?.[1] ?? '',
          height: /(?:^|\s)height="([^"]*)"/.exec(attrs)?.[1] ?? '',
          list: classListOfAttrs(attrs) ?? '',
        })
      }
    }
  }
  return found
}

const CALL_SITES = callSites(PARTS)

/** 弹窗的那些调用点 ✓。 */
const DIALOG_SITES = CALL_SITES.filter((site) => site.part === 'DialogContent')

/**
 * 那些**自己也有宽度刻度**的共享零件 ✓。
 *
 * 弹窗 ✓、卡片 ✓、抽屉 ✓——**弹窗的刻度早就有了** ✓（64 号 ✓），
 * **卡片和抽屉的没有** ✗，于是调用点自己写宽度 ✗。
 */
const WIDTH_PARTS: Record<string, string> = {
  Card: 'components/ui/card.tsx',
  SideDrawer: 'components/ui/side-drawer.tsx',
  Row: 'components/ui/row.tsx',
}

/** 它们各自的刻度写在哪张表里 ✓。 */
const WIDTH_SCALES: ReadonlyArray<readonly [string, string]> = [
  ['Card', 'CARD_WIDTHS'],
  ['SideDrawer', 'SIDE_DRAWER_WIDTHS'],
  ['Row', 'ROW_WIDTHS'],
]

const WIDTH_SITES = callSites(WIDTH_PARTS)

/** 某一个共享零件自己说的那道刻度 ✓。 */
function widthScaleOf(part: string, declaration: string): Map<string, string> {
  const rel = WIDTH_PARTS[part]
  const source = SOURCES.find((candidate) => candidate.rel === rel)
  return source ? recordOf(source.text, declaration) : new Map()
}

describe('共享零件的脸，各有各副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 每一副都写着什么 ✓。
    for (const part of Object.keys(PARTS)) {
      const variants = variantsOfPart(part)
      expect(variants.size, `共享的 ${part} 没有档，这道门禁多半读错了地方`).toBeGreaterThan(1)
    }
    expect(variantsOfPart('Badge').has('success'), '徽章没有成功那一副').toBe(true)
    expect(variantsOfPart('Alert').has('success'), '警告没有成功那一副').toBe(true)
    expect(variantsOfPart('Card').has('flat'), '卡片没有"嵌在面板里"那一副').toBe(true)
    expect(variantsOfPart('TabsList').has('bar'), '页签条没有"贴在边上"那一副').toBe(true)
    expect(variantsOfPart('TabsTrigger').has('bar'), '页签没有"贴在边上"那一副').toBe(true)
    expect(variantsOfPart('DialogFooter').has('divided'), '底行没有"上面有一道线"那一副').toBe(true)
    expect(variantsOfPart('DialogContent').has('solid'), '弹窗没有"实心的"那一副').toBe(true)
    expect(variantsOfPart('FormItem').has('boxed'), '表单没有"一个带边框的盒子"那一副').toBe(true)
    // 行**必须**有"选中的那一个" ✓ 那一副 ✓ —— 没有它 ✓，
    // **选中就看不出** ✓，而清单里的一半意思是这个 ✓。
    const rowSource = SOURCES.find((candidate) => candidate.rel === PARTS.Row)
    const rowSelected = variantsOf(rowSource?.text ?? '', 'selected')
    expect(
      rowSelected.get('true'),
      '共享的行没有"选中的那一个"那一副',
    ).toBeTruthy()

    // 找得到调用点 ✓。
    expect(CALL_SITES.length, '一个徽章或警告的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(10)

    // 弹窗的宽和高**各有一道刻度** ✓，而且**每一档都有人用** ✓：
    // 说了刻度上没有的名字 ✗，是**多了一副** ✗；
    // 刻度上有一档没人用 ✗，是**摆在那儿没人要** ✗。
    const widths = scaleOf('DIALOG_CONTENT_WIDTHS')
    const heights = scaleOf('DIALOG_CONTENT_HEIGHTS')
    expect(widths.size, '弹窗没有宽度刻度').toBeGreaterThan(1)
    expect(heights.size, '弹窗没有高度刻度').toBeGreaterThan(1)

    const saidWidths = new Set(DIALOG_SITES.map((site) => site.width).filter(Boolean))
    const saidHeights = new Set(DIALOG_SITES.map((site) => site.height).filter(Boolean))
    expect(
      [...widths.keys()].filter((step) => !saidWidths.has(step)),
      '这些宽度档没有人用',
    ).toEqual([])
    expect(
      [...heights.keys()].filter((step) => !saidHeights.has(step)),
      '这些高度档没有人用',
    ).toEqual([])
    expect(
      [...saidWidths].filter((step) => !widths.has(step)),
      '说了刻度上没有的宽度',
    ).toEqual([])
    expect(
      [...saidHeights].filter((step) => !heights.has(step)),
      '说了刻度上没有的高度',
    ).toEqual([])

    // 认得脸上那几类 ✓——以及"带前缀的是状态" ✓、"哪一边的是形状" ✓。
    expect(FACE_TOKEN.test('bg-success'), '认不出一个背景').toBe(true)
    expect(FACE_TOKEN.test('border-warning'), '认不出一道边框').toBe(true)
    expect(FACE_TOKEN.test('hover:bg-muted'), '把一个状态当成了脸').toBe(false)
    expect(SHAPE_TOKEN.test('rounded-l-none'), '认不出一个形状').toBe(true)
  })

  it('一副脸里，字和底不许是同一个颜色', () => {
    // `bg-success` 是 `#27ae60` ✗，`text-success` **也是** ✗——
    // 字和它自己的底一个颜色 ✗，**看不见** ✗。
    // 半透明的底 ✗（`bg-destructive/10` ✓）不算 ✗：那底子几乎透明 ✗，字看得见 ✓。
    // **底子**也要看 ✓：卡片那一副的脸 ✗，就写在它的底子上 ✗。
    const offenders: string[] = []
    for (const [part, rel] of Object.entries(WITH_VARIANTS)) {
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      const faces: Array<readonly [string, string]> = [
        ['底子', ownListOf(source?.text ?? '')],
        ...variantsOfPart(part).entries(),
      ]
      for (const [name, list] of faces) {
        const tokens = list.split(/\s+/).filter(Boolean)
        const background = tokens.find((token) => /^bg-[a-z-]+$/.test(token))?.slice(3)
        const text = tokens.find((token) => /^text-[a-z-]+$/.test(token))?.slice(5)
        if (!background || !text) continue
        if (background !== text) continue
        offenders.push(`${part}  ${name}  这一副 底和字都是 ${background}`)
      }
    }

    expect(
      offenders,
      [
        `这些副脸里，字和底是同一个颜色：${offenders.length} 处`,
        ...offenders,
        '字要看得见：底是一个颜色，字就得是另一个。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不许重复它那一档说过的话', () => {
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      const said = saidBy(variantsOfPart(site.part), site.variant)
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!said.has(token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part} ${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方把那一档的话又说了一遍：${offenders.length} 处`,
        ...offenders,
        '徽章和警告的脸是它们那一档的事：要哪一副，就说哪一副。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不许自己写脸上那几类', () => {
    // **带前缀的那一句不算** ✓——那是**状态** ✗。
    // **哪一边的那一句也不算** ✓——那是**形状** ✗。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!FACE_TOKEN.test(token)) continue
        if (SHAPE_TOKEN.test(token)) continue
        if (excused(site.rel, site.part, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part} ${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了一张脸：${offenders.length} 处`,
        ...offenders,
        '要哪一副脸，就说哪一副（`variant="success"`、`variant="outline-warning"`）。',
        '状态不是脸——`hover:` 那一类不算；形状也不是脸——`rounded-l-none` 那一类不算。',
      ].join('\n'),
    ).toEqual([])
  })

  it('弹窗在屏幕上占多宽、多高，是共享零件的事', () => {
    // 弹窗有多宽 ✗、有多高 ✗，是共享零件的尺寸 ✓——三十一处调用点自己写宽 ✗，
    // 十八处自己写高 ✗，其中几处是随手写的数 ✗（420 ✗、440 ✗、500 ✗、560 ✗）✗，
    // **不在任何刻度上** ✗。
    const offenders: string[] = []
    for (const site of DIALOG_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        const aWidth = A_WIDTH.test(token)
        const aHeight = A_HEIGHT.test(token)
        if (!aWidth && !aHeight) continue
        // **满屏**的那些说法 ✓：它们是同一个决定 ✓，不是刻度上的某一档 ✓。
        if (FULL_SCREEN.includes(token)) continue
        if (excused(site.rel, site.part, token)) continue
        offenders.push(`${site.rel}:${site.line}  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了弹窗的宽或高：${offenders.length} 处`,
        ...offenders,
        '弹窗占屏幕多宽、多高是共享零件的事：要哪一档，就说哪一档（`width="md"`、`height="tall"`）。',
      ].join('\n'),
    ).toEqual([])
  })

  it('卡片和抽屉的宽度，是共享零件的事', () => {
    // 卡片**有多宽** ✗、抽屉**有多宽** ✗，也是共享零件的尺寸 ✓——
    // 卡片**七处**自己写 `max-w-md` ✗ / `max-w-3xl` ✗，
    // 抽屉自己写 `min(85vw,320px)` ✗——**随手写的数** ✗，不在任何刻度上 ✗。
    const offenders: string[] = []
    for (const site of WIDTH_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!A_WIDTH.test(token)) continue
        // **满屏**的那些说法 ✓：它们是同一个决定 ✓，不是刻度上的某一档 ✓。
        if (FULL_SCREEN.includes(token)) continue
        if (excused(site.rel, site.part, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了宽度：${offenders.length} 处`,
        ...offenders,
        '卡片和抽屉有多宽是共享零件的事：要哪一档，就说哪一档（`width="md"`）。',
      ].join('\n'),
    ).toEqual([])
  })

  it('每一道宽度刻度都有人用', () => {
    // 一道**没人用的档** ✗，就是**摆在那儿** ✗——要么去掉它 ✓，要么用它 ✓。
    for (const [part, declaration] of WIDTH_SCALES) {
      const steps = widthScaleOf(part, declaration)
      expect(steps.size, `${part} 没有宽度刻度`).toBeGreaterThan(0)
      const said = new Set(
        WIDTH_SITES.filter((site) => site.part === part && site.width).map((site) => site.width),
      )
      // **默认的那一档** ✓ 也算有人用 ✓ —— 那些**没有说宽度**的调用点 ✓
      // 用的是它 ✓，它当然不是摆在那儿的 ✓。
      const partSource = SOURCES.find((candidate) => candidate.rel === WIDTH_PARTS[part])?.text ?? ''
      for (const step of steps.keys()) {
        if (partSource.includes(`width = '${step}'`) || partSource.includes(`width = "${step}"`)) {
          said.add(step)
        }
      }
      expect(
        [...steps.keys()].filter((step) => !said.has(step)),
        `${part} 的这些宽度档没有人用`,
      ).toEqual([])
      expect(
        [...said].filter((step) => !steps.has(step)),
        `${part} 说了刻度上没有的宽度`,
      ).toEqual([])
    }
  })

  it('被点名的那些，理由都写清楚了，而且都还在', () => {
    const seen = new Set<string>()
    for (const [rel, part, token, reason] of EXCEPTIONS) {
      expect(reason.trim().length, `${rel} 的 ${token} 没有写为什么它不一样`).toBeGreaterThan(0)
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `例外里的 ${rel} 已经不存在了`).toBeDefined()
      expect(
        source!.text.includes(token),
        `例外里的 ${rel} 已经不再写 ${token} 了`,
      ).toBe(true)

      // **同一处不许写两遍** ✓。
      const mark = `${rel} ${part} ${token}`
      expect(seen.has(mark), `例外里的 ${mark} 写了两遍`).toBe(false)
      seen.add(mark)

      // **一个例外只放过一处** ✓：同一句在同一文件里 ✗，
      // 若盖住了两个地方 ✗，那它就不是一次性的例外 ✗，而是**又该长出一副脸** ✗。
      const covered = CALL_SITES.filter(
        (site) =>
          site.rel === rel &&
          site.part === part &&
          site.list.split(/\s+/).includes(token),
      ).length
      expect(
        covered,
        `例外里的 ${mark} 在那个文件里盖住了 ${covered} 处，一个例外只放过一处`,
      ).toBe(1)
    }
  })
})
