import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, cvaBase, elementTree, iconNames, isIconName, stripComments, tagAt, variantsOf } from './source-text'

/**
 * 按钮的脸，是它那一档的事。
 *
 * 共享的按钮有一道**档**（variant ✓）：`default` ✓、`outline` ✓、`secondary` ✓、
 * `ghost` ✓、`destructive` ✓、`link` ✓——每一档写明自己的脸 ✓（背景 ✓、边框 ✓、
 * 悬停 ✓、阴影 ✓、文字颜色 ✓）。
 *
 * 于是**调用点把那一档的话又说了一遍** ✗——`bg-primary hover:bg-primary-hover
 * text-primary-foreground` ✗，那是 `default` 那一档**已经说过的话** ✗。
 *
 * 说着说着 ✗，两边就不一样了 ✗：57 号那轮发现的 `hover:bg-primary` ✗
 * 就是这么来的 ✗——共享件说"悬停时暗一点" ✗（`hover:bg-primary-hover` ✓），
 * 调用点说"悬停时不暗" ✗（`hover:bg-primary` ✓），**而后写的那个赢** ✗。
 *
 * 同一句话说了两遍 ✗，就等于**有两个地方能改它** ✗——
 * 改了一处 ✗，另一处不动 ✗，按钮就变了样 ✗。
 *
 * 所以这一轮：**调用点不许重复它那一档说过的话** ✓。
 *
 * 而那一轮之后还剩下一件事 ✗：**有的按钮画的是另一张脸** ✗——
 * 绿色的 ✗、危险色描边的 ✗、灰色的 ✗，一个一个写在调用点上 ✗，
 * 每一种还都写着**不止一种写法** ✗（绿的有白字 ✗、有绿图标 ✗）。
 *
 * 于是它们**有了名字** ✓：`success` ✓、`outline-destructive` ✓、
 * `secondary` ✓——和尺寸的那道楼梯一样 ✓，每一档写明自己的脸 ✓。
 *
 * 所以这一轮的第二件事：**调用点不许自己写脸上那几类** ✓——
 * **带前缀的那一句不算** ✓，那是**状态** ✗（`hover:bg-muted` ✓ 是悬停时变灰 ✓）。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那个按钮 ✓。 */
const SHARED_BUTTON = 'components/ui/button.tsx'

/** 每一档说了什么 ✓。 */
const VARIANTS = variantsOf(
  SOURCES.find((source) => source.rel === SHARED_BUTTON)?.text ?? '',
  'variant',
)

/**
 * 脸上那几类 ✓。
 *
 * **没有前缀的** ✓才是脸本身 ✓——带前缀的那一句 ✗ 是**状态** ✗
 * （`focus:bg-muted` ✓ 是聚焦时变灰 ✓），不是另一张脸 ✗。
 *
 * **悬停色是唯一的例外** ✗ —— 那一类 ✗ **归那一档管** ✓，
 * 另一道门禁盯着它 ✓（"调用点不许自己写悬停色" ✓）。
 */
const FACE_TOKEN = /^(?:rounded|bg|border|shadow)(?:-|$)/

/**
 * **哪一边**的那些 ✗ 是在改**形状** ✓，不是另一张脸 ✗。
 *
 * `rounded-l-none` ✓ 是"只有右边是圆的" ✓，`border-l-0` ✓ 是"左边不要边框" ✓——
 * 它们说的还是**这一副脸** ✓，只是它的边 ✗。
 */
const SHAPE_TOKEN = /^(?:rounded|border)-(?:[lrtybxy]{1,2})(?:-|$)/

/**
 * **悬停色** ✓ —— 那是**那一档的话** ✓，不是调用点的话 ✓。
 *
 * `hover:text-foreground` ✗ `hover:bg-muted` ✗ `hover:border-…` ✗
 * —— 这一类 ✗ **归那一档管** ✓。
 */
const HOVER_COLOUR = /^(?:[a-z0-9-]+:)*hover:(?:text|bg|border)-/

/**
 * 一次性的那几处，各有理由。
 *
 * - 会话页头部那两个键 ✗：**一直亮着** ✗（打开与否都是这一副脸 ✗）。
 * - 标题栏里那个和输入框**连在一起**的键 ✗：它要一道边框 ✓，
 *   也只要那一道 ✓。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'pages/SessionDetail.tsx',
    'bg-accent',
    '这一栏**一直亮着** ✗（打开与否都是这一副脸 ✗）',
  ],
  [
    'components/ui/header.tsx',
    'border',
    '这个键和输入框**连在一起** ✗：它要一道边框 ✓',
  ],
  [
    'components/ui/header.tsx',
    'border-border',
    '这个键和输入框**连在一起** ✗：边框就是那一道 ✓',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, token: string): boolean {
  return EXCEPTIONS.some(([file, marked]) => file === rel && marked === token)
}

/** 那一档说过的每一个词 ✓。 */
function saidBy(variant: string): Set<string> {
  const words = new Set<string>()
  for (const token of (VARIANTS.get(variant) ?? '').split(/\s+/)) {
    if (token) words.add(token)
  }
  return words
}

interface CallSite {
  rel: string
  line: number
  variant: string
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
        variant: /(?:^|\s)variant="([^"]*)"/.exec(attrs)?.[1] ?? 'default',
        list: classListOfAttrs(attrs) ?? '',
      })
    }
  }
  return found
}

const CALL_SITES = callSites()

describe('按钮的脸，是它那一档的事', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 每一档都写着什么 ✓。
    expect(VARIANTS.size, '共享的按钮没有档，这道门禁多半读错了地方').toBeGreaterThan(4)
    for (const name of ['default', 'outline', 'ghost', 'selected']) {
      expect(VARIANTS.has(name), `共享的按钮没有 ${name} 那一档`).toBe(true)
    }
    // **黄色是警告的** ✓ —— 门禁盯着它 ✓。
    expect(VARIANTS.has('warning'), '共享的按钮没有警告那一副').toBe(true)

    // 认得那一档说过的每一个词 ✓。
    const outline = saidBy('outline')
    expect(outline.has('border-border'), '认不出 outline 那一档的边框').toBe(true)
    expect(outline.has('hover:bg-accent'), '认不出 outline 那一档的悬停').toBe(true)
    expect(saidBy('default').has('bg-primary'), '认不出 default 那一档的背景').toBe(true)
    // **绿色不是按钮的** ✓：绿色是**标记** ✓ 和**消息** ✓ 的 ✓——
    // 按钮**不许**有那一副脸 ✓。
    expect(
      VARIANTS.has('success'),
      '共享的按钮还有绿色的那一副——绿色是标记和消息的，不是按钮的',
    ).toBe(false)
    expect(
      [...VARIANTS.values()].some((list) => /(^|\s)bg-success(\s|$)/.test(list)),
      '有一副脸是绿的——按钮不许是绿的',
    ).toBe(false)
    // **亮着的那一副** ✓：它自己有名字 ✓，不是调用点自己写的主色 ✓。
    expect(saidBy('selected').has('bg-primary'), '认不出 selected 那一档的背景').toBe(true)
    expect(
      saidBy('selected').has('hover:bg-primary-hover'),
      'selected 那一档没有自己的悬停——它会落回 outline 的那一档 ✗',
    ).toBe(true)

    // 找得到调用点 ✓。
    expect(CALL_SITES.length, '一个按钮的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(100)

    // **认得出"同一句话说了两遍"** ✓——不然这道门禁在空集上跑，永远是绿的 ✓。
    const repeated = [
      'bg-primary',
      'hover:bg-primary-hover',
      'text-primary-foreground',
    ].filter((token) => saidBy('default').has(token))
    expect(repeated.length, '认不出"同一句话说了两遍"').toBe(3)

    // 认得脸上那几类 ✓——以及"带前缀的那一句是状态，不是脸" ✓。
    expect(FACE_TOKEN.test('bg-muted'), '认不出一个背景').toBe(true)
    expect(FACE_TOKEN.test('border-border'), '认不出一道边框').toBe(true)
    expect(FACE_TOKEN.test('hover:bg-muted'), '把一个状态当成了脸').toBe(false)
  })

  it('调用点不许重复它那一档说过的话', () => {
    // 同一句话说了两遍 ✗，就等于有两个地方能改它 ✗。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      const said = saidBy(site.variant)
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!said.has(token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方把那一档的话又说了一遍：${offenders.length} 处`,
        ...offenders,
        '按钮的脸是它那一档的事：要哪一副脸，就说哪一档（`variant="outline"`）。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不许自己写悬停色', () => {
    // 悬停色 ✓ **也是那一档的事** ✓。
    //
    // 以前 ✗ 这一类不算"脸" ✗（"带前缀的那一句是状态" ✓）—— 于是 ✗
    // **九处小图标键 ✗ 各自写了一句** ✓ `hover:text-foreground` ✓，
    // 而 `ghost` 那一档 ✗ **说的是 `hover:text-accent-foreground`** ✓。
    // 两句都在 ✓，**后写的赢** ✓ —— 于是那些键 ✗
    // **蓝底 ✗ 暗字** ✓（accent 的底 ✓ + foreground 的字 ✗）✗ **对比度坏了** ✗。
    //
    // 而**另外七十二个** ghost 键 ✓ 本来就用的是那一副脸 ✓ ——
    // **不一致的是那九处** ✓，不是那七十二处 ✓。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!HOVER_COLOUR.test(token)) continue
        if (excused(site.rel, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了悬停色：${offenders.length} 处`,
        ...offenders,
        '悬停色是那一档的事：要哪一副脸，就说哪一档（`variant="ghost-destructive"`）。',
      ].join('\n'),
    ).toEqual([])
  })

  it('调用点不许自己写脸上那几类', () => {
    // 脸只有一副 ✓。调用点自己写一个背景 ✗、一道边框 ✗、一个圆角 ✗、
    // 一道阴影 ✗，就是**另一张脸** ✗。
    // **带前缀的那一句不算** ✓——那是**状态** ✗（`focus:bg-muted` ✓ 是聚焦时变灰 ✓）。
    // **哪一边的那一句也不算** ✓——那是**形状** ✗（`rounded-l-none` ✓）。
    // **悬停色 ✗ 也不算脸** ✗ —— 它**归那一档管** ✓，另一道门禁盯着 ✓。
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const token of site.list.split(/\s+/)) {
        if (!token) continue
        if (!FACE_TOKEN.test(token)) continue
        if (SHAPE_TOKEN.test(token)) continue
        if (excused(site.rel, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.variant}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了一张脸：${offenders.length} 处`,
        ...offenders,
        '要哪一副脸，就说哪一档（`variant="success"`、`variant="outline-destructive"`）。',
        '状态不是脸——`hover:` 那一类不算；形状也不是脸——`rounded-l-none` 那一类不算。',
      ].join('\n'),
    ).toEqual([])
  })

  it('图标说大小，只说 `size-N`', () => {
    // 共享按钮的底子上有 `[&_svg:not([class*='size-'])]:size-4` ✓ ——
    // 图标写 `w-5 h-5` ✗ **在按钮里不算数** ✗：那条规则排在 `w-5` ✓
    // **后面** ✓、更具体 ✓，所以按钮里的图标一律被压成 16px ✓。
    //
    // 而那条规则**故意**留着 `[class*='size-']` ✓ —— 意思就是：
    // **图标要另一个大小 ✓，就说 `size-5` ✓**（那条规则就不碰它 ✓）。
    //
    // 按钮外面 ✗ 写 `w-5 h-5` ✓ 倒也画得出来 ✓，
    // 可那样 ✗ 全应用就有了**两套话** ✗ —— 副的不该有 ✗，要的是一副 ✓。
    //
    // 所以这一轮：**图标说大小，只说 `size-N`** ✓。
    const offenders: string[] = []
    for (const source of SOURCES) {
      const icons = iconNames(source.text)
      if (icons.size === 0) continue
      for (const element of elementTree(source.text)) {
        // 图标是**从图标库进来的那个名字** ✓，或者**自己就说自己是图标**
        // ✓（`Icon` ✓、`item.icon` ✓）——不是"碰巧首字母大写" ✓。
        if (!isIconName(element.name, icons)) continue
        const classes = element.classes
        if (!/(?:^|\s)(?:[a-z0-9-]+:)?(?:w|h)-\d/.test(classes)) continue
        const line = source.text.slice(0, element.start).split('\n').length
        offenders.push(`${source.rel}:${line}  ${element.name}  ${classes}`)
      }
    }

    expect(
      offenders,
      [
        `这些图标用 w- h- 说大小：${offenders.length} 处`,
        ...offenders,
        '图标说大小，只说 `size-N` ✓——`w-` `h-` 那套话，共享按钮认都不认 ✓。',
      ].join('\n'),
    ).toEqual([])

    // 共享按钮的底子 ✓：默认 **16px** ✓，并且**留着后门** ✓——
    // 没有那个后门 ✓，图标说多大都不算 ✓。
    const base = cvaBase(
      SOURCES.find((candidate) => candidate.rel === SHARED_BUTTON)?.text ?? '',
      'buttonVariants',
    )
    expect(base, '共享的按钮读不出自己的底子').toContain('size-4')
    expect(
      base,
      '共享的按钮不再给图标留后门了——图标说多大都不算了',
    ).toContain("[class*='size-']")
  })

  it('被点名的那些，理由都写清楚了，而且都还在', () => {
    for (const [rel, token, reason] of EXCEPTIONS) {
      expect(reason.trim().length, `${rel} 的 ${token} 没有写为什么它不一样`).toBeGreaterThan(0)
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `例外里的 ${rel} 已经不存在了`).toBeDefined()
      expect(
        source!.text.includes(token),
        `例外里的 ${rel} 已经不再写 ${token} 了`,
      ).toBe(true)
    }
  })
})
