import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, stripComments, tagAt, variantsOf } from './source-text'

/**
 * 原生 `<button>` 不许自己画脸。
 *
 * 共享的那个按钮（`components/ui/button.tsx` ✓）有**一道档** ✓（variant ✓）——
 * `default` ✓、`outline` ✓、`secondary` ✓、`ghost` ✓、`destructive` ✓、`link` ✓，
 * 这一轮又添了**五副** ✓：`glass` ✓（浮在一层半透明上面的 ✓）、`muted` ✓（安静的、带细边的 ✓）、
 * `accent` ✓（主色描边的 ✓）、`stop` ✓（停下来的那个 ✓）、`keycap` ✓（键帽 ✓），
 * 还有**一副** ✓ `ghost-destructive` ✓（悬停时变红的那个 ✓），
 * 以及**两个圆形的尺寸档** ✓（`icon-circle` ✓、`icon-circle-sm` ✓）。
 *
 * 可是**原生 `<button>`** ✗ 还在自己画 ✗：**底** ✓、**边** ✓、**影** ✓、**圆角** ✓——
 * 一百二十处原生按钮 ✗，**三十四处自己写了脸** ✗。
 *
 * 于是这两轮：**三十七处换成了共享的那个按钮** ✓，
 * 每一处**说清自己是谁** ✓（`variant="glass"` ✓、`variant="muted"` ✓ …）。
 * —— 其中 ✗**三个可点的块** ✓（作业 ✓、版本 ✓、语音模型 ✓、答案 ✓）✓
 * **长成了共享零件的样子** ✓：条子 ✓（`chip` ✓）✓、板 ✓（`tile` ✓）✓，
 * **选中那一个** ✓ 也各有名字 ✓（`chip-selected` ✓）。
 * 而 ✗**页签** ✓ **用上了共享的 `bar` 档** ✓（61 号起的名字 ✓，这一轮才真的用上 ✓）。
 *
 * 而**根本不是按钮的那几处** ✗——**列表里的一行** ✓、**一个浮层上的叉** ✓、
 * **跟着 agent 走的那个键** ✓——它们**点名** ✓，并且**写清楚自己是什么** ✓。
 *
 * 门禁按**形状**判 ✓：一个原生 `<button>` ✗ **写了任何一句脸** ✗
 * → 它就是**另一副按钮** ✗——**写全了没有不算** ✓，**只写一半也不行** ✓。
 *
 * - **哪一边的那一句不算** ✓——`border-b-2` ✓ 那是**形状** ✓，不是脸 ✓。
 * - **跟着变量走的颜色不算** ✓——`bg-[var(--agent-bg-light)]` ✓
 *   那个底**跟着内容走** ✓，不是它自己画的那一个 ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那个按钮 ✓。 */
const SHARED_BUTTON = 'components/ui/button.tsx'

/** 它的每一副 ✓。 */
const VARIANTS = variantsOf(
  SOURCES.find((source) => source.rel === SHARED_BUTTON)?.text ?? '',
  'variant',
)

/**
 * 脸上那几类 ✓。
 *
 * **没有前缀的** ✓才是脸本身 ✓——带前缀的那一句 ✗ 是**状态** ✗
 * （`hover:bg-muted` ✓ 是悬停时变灰 ✓），不是一张脸 ✗。
 */
const FACE_TOKEN = /^(?:rounded|bg|border|shadow)(?:-|$)/

/**
 * **哪一边**的那些 ✗ 是在改**形状** ✓，不是一张脸 ✓。
 *
 * `border-b-2` ✓ 是"只有下面那一道" ✓——它改的是**哪一边** ✓，不是**是什么颜色** ✓。
 */
const SHAPE_TOKEN = /^(?:rounded|border)-(?:[lrtybxy]{1,2})(?:-|$)/

/**
 * 跟着**变量**走的颜色 ✓。
 *
 * `bg-[var(--agent-bg-light)]` ✓ 的底 ✓ **跟着内容走** ✓——
 * 它不是这个按钮自己画的那一个 ✓，所以不算 ✓。
 */
const FROM_CONTENT = /\bvar\(/

/**
 * 被点名的那几处，各有理由。
 *
 * 点名的是**一个按钮** ✓（写它脸上的一句 ✓ 就够了 ✓）——
 * 它**根本不是按钮** ✓，而是**别的零件** ✓：
 *
 * - **列表里的一行** ✓（provider ✓、抽屉里的一项 ✓、命令面板里的一项 ✓、顶栏里的一项 ✓、
 *   文件树里的一项 ✓、命令列表里的一项 ✓、@ 列表里的一项 ✓、分支列表里的一项 ✓、
 *   提交列表里的一项 ✓、文件列表里的一项 ✓）：选中时它自己带一层底 ✓，那是一行 ✓，不是按钮 ✓。
 * - **一个筛选项 / 一个语音模型 / 一个版本 / 一个工具调用** ✓：
 *   选中时它自己带一道边 ✓，那是一个**标记** ✓，不是按钮 ✓。
 * - **一个可点的答案** ✓：它自己带一层底 ✓，那是一个**选项** ✓，不是按钮 ✓。
 * - **一张卡的头** ✓（工具调用 ✓、改动 ✓、模型列表底下那一行 ✓）：
 *   它自己带着卡片的底 ✓，那是一张**卡** ✓，不是按钮 ✓。
 * - **盖住下面的那层黑** ✓：它遮住东西 ✓，不是按钮 ✓。
 * - **底色跟着状态走的那些键** ✓（发送 ✓、测试语音 ✓、放声音 ✓、编辑器里那一行 ✓）：
 *   要权限时是警告色 ✓，平时是主色 ✓——那是**状态** ✓，不是另一副按钮 ✓。
 * - **脸跟着内容走的那些键** ✓（agent ✓、语音 ✓）：那张脸是**内容给的** ✓，不是它自己画的 ✓。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'components/ui/backdrop.tsx',
    'bg-black/40',
    '这就是**那层黑** ✓ —— 它**自己就是**那个零件 ✓，不是调用点画的脸 ✓',
  ],
  [
    'features/message/AgentQuickSelect.tsx',
    'border',
    '这个键**跟着 agent 的颜色走** ✓：它的脸是**内容给的** ✓，不是它自己画的 ✓',
  ],
  [
    'features/session/QuestionPrompt.tsx',
    'bg-success/10',
    '这是**一个可点的答案** ✓：答对了它自己带一层底 ✓，那是一个**选项** ✓，不是按钮 ✓',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, token: string): boolean {
  return EXCEPTIONS.some(([file, marked]) => file === rel && marked === token)
}

/** 一个原生 `<button>`。 */
interface RawButton {
  rel: string
  line: number
  list: string
}

function rawButtons(): RawButton[] {
  const found: RawButton[] = []
  for (const source of SOURCES) {
    const matcher = /<button\b/g
    let match: RegExpExecArray | null
    while ((match = matcher.exec(source.text)) !== null) {
      const opening = tagAt(source.text, match.index)
      const attrs = opening.slice('<button'.length, opening.endsWith('>') ? -1 : undefined)
      found.push({
        rel: source.rel,
        line: source.text.slice(0, match.index).split('\n').length,
        list: classListOfAttrs(attrs) ?? '',
      })
    }
  }
  return found
}

const RAW_BUTTONS = rawButtons()

/**
 * 这个按钮自己画的那张脸 ✓。
 *
 * **哪一边的那一句不算** ✓；**跟着变量走的颜色不算** ✓。
 */
function faceOf(list: string): string[] {
  return list
    .split(/\s+/)
    .filter(
      (token) =>
        token &&
        FACE_TOKEN.test(token) &&
        !SHAPE_TOKEN.test(token) &&
        !FROM_CONTENT.test(token),
    )
}

describe('原生 button 不许自己画脸', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到原生按钮 ✓。
    expect(
      RAW_BUTTONS.length,
      '一个原生按钮都没找到，这道门禁多半跑在空集上',
    ).toBeGreaterThan(40)

    // 共享的那个按钮有档 ✓。
    expect(VARIANTS.size, '共享的按钮没有档，这道门禁多半读错了地方').toBeGreaterThan(4)
    for (const name of ['default', 'outline', 'ghost', 'destructive']) {
      expect(VARIANTS.has(name), `共享的按钮没有 ${name} 那一档`).toBe(true)
    }
    // 这一轮添的那五副 ✓，还有那一副悬停变红的 ✓。
    for (const name of ['glass', 'muted', 'accent', 'stop', 'keycap', 'ghost-destructive']) {
      expect(VARIANTS.has(name), `共享的按钮没有 ${name} 那一档`).toBe(true)
    }

    // 认得脸上那几类 ✓——以及"哪一边的是形状" ✓、"跟着变量走的不算" ✓。
    expect(FACE_TOKEN.test('bg-muted'), '认不出一个背景').toBe(true)
    expect(FACE_TOKEN.test('border-border'), '认不出一道边框').toBe(true)
    expect(FACE_TOKEN.test('shadow-md'), '认不出一个影子').toBe(true)
    expect(FACE_TOKEN.test('hover:bg-muted'), '把一个状态当成了脸').toBe(false)
    expect(SHAPE_TOKEN.test('border-b-2'), '把哪一边当成了脸').toBe(true)
    expect(FROM_CONTENT.test('bg-[var(--agent-bg-light)]'), '认不出跟着内容走的颜色').toBe(true)
  })

  it('原生 button 不许自己写脸', () => {
    const offenders: string[] = []
    for (const button of RAW_BUTTONS) {
      const faces = faceOf(button.list)
      // **脸只写一处** ✓：一个原生 button ✗ 写了**任何一句**脸 ✗，
      // 它就是**另一副按钮** ✗——不管那副脸写全了没有 ✗。
      if (!faces.length) continue
      // 点名的是**一个按钮** ✓：它脸上**任何一句**被点名 ✓，它就放行 ✓。
      if (faces.some((token) => excused(button.rel, token))) continue
      offenders.push(`${button.rel}:${button.line}  ${faces.join(' ')}`)
    }

    expect(
      offenders,
      [
        `这些地方自己画了一张脸：${offenders.length} 处`,
        ...offenders,
        '按钮的脸是共享那个零件的事：要哪一副，就说哪一副（`variant="muted"`）。',
        '它**根本不是按钮**的话（列表里的一行 ✓、一个标记 ✓），写进 EXCEPTIONS 并说明理由。',
        '状态不是脸——`hover:` 那一类不算；形状也不是脸——`border-b-2` 那一类不算。',
      ].join('\n'),
    ).toEqual([])
  })

  it('被点名的那些，理由都写清楚了，而且都还在', () => {
    const seen = new Set<string>()
    for (const [rel, token, reason] of EXCEPTIONS) {
      expect(reason.trim().length, `${rel} 的 ${token} 没有写为什么它不一样`).toBeGreaterThan(0)
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `例外里的 ${rel} 已经不存在了`).toBeDefined()
      expect(
        source!.text.includes(token),
        `例外里的 ${rel} 已经不再写 ${token} 了`,
      ).toBe(true)

      const mark = `${rel} ${token}`
      expect(seen.has(mark), `例外里的 ${mark} 写了两遍`).toBe(false)
      seen.add(mark)

      // 而且**它还在管用** ✓：那个文件里 ✗ **确实有**那一处 ✗。
      const covers = RAW_BUTTONS.filter(
        (button) =>
          button.rel === rel &&
          faceOf(button.list).includes(token),
      ).length
      expect(
        covers,
        `例外里的 ${mark} 在那个文件里已经用不上了——它盖住了 ${covers} 处`,
      ).toBeGreaterThan(0)
    }
  })
})
