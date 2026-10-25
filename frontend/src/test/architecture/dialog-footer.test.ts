import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, cvaBase, elementTree, familyOf, heightsFrom, stripComments, variantsOf } from './source-text'

/**
 * 弹窗底下的按钮行，只有一副样子。
 *
 * 七十个弹窗里，底下有一行按钮的有二十八个 ✗——而它们说的是好几种话 ✗：
 * 十六个用平常那一档（36px）✗，三个用 `touch`（手机上 44、桌面上 36）✗，
 * 两个用 `wide`（36 → 40）✗。更要紧的是**高度**：那一行有 32、36、40、44 四种 ✗，
 * 而"手机上够得着"这条规矩 ✗，只有三个弹窗做到了 ✗。
 *
 * 还有七个弹窗**自己抄了一遍共享的 `DialogFooter` 的类名** ✗——
 * `flex flex-row gap-2 … sm:justify-end` ✗——共享的那一副它自己已经说了 ✗。
 *
 * 所以这一轮：
 *
 * - **每一行的按钮，说的是同一句话** ✓：二十八个弹窗底下的按钮都是 `touch` ✓——
 *   手机上是手指尺寸 ✓，桌面上是平常的尺寸 ✓。
 * - **那一行是共享的那一个** ✓：七个自己写的底行换成了共享的 `DialogFooter` ✓，
 *   而共享的那副类名 ✗，不许在别处再写一遍 ✓。
 *
 * 判的是**形状**：一个弹窗的底部行 ✓、那一行里的按钮 ✓，
 * 以及共享的按钮那道楼梯上、那一档在每一种屏幕上多高 ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那个底部行 ✓，和共享的那个按钮 ✓。 */
const SHARED_FOOTER = 'components/ui/dialog.tsx'
const SHARED_BUTTON = 'components/ui/button.tsx'

/**
 * 手指够得着的最小高度 ✓。
 *
 * Breeze 要的是 44px ✓——手机上这一点东西要按得中 ✓。
 */
const FINGER_PX = 44

/**
 * 共享的底部行自己说的那副类名。
 *
 * 共享的零件是函数 ✗，所以它的类名不在一个标签上 ✗——它在那个函数自己的
 * `cn(...)` 里 ✓。
 */
function sharedFooterClasses(): string[] {
  const source = SOURCES.find((candidate) => candidate.rel === SHARED_FOOTER)
  if (!source) return []
  const base = cvaBase(source.text, 'dialogFooterVariants')
  return base.split(/\s+/).filter(Boolean)
}

/** 共享的按钮那道楼梯 ✓。 */
const BUTTON_VARIANTS = variantsOf(
  SOURCES.find((source) => source.rel === SHARED_BUTTON)?.text ?? '',
)

/**
 * 一档在某一档屏幕上多高。
 *
 * 平常那一档是它自己写的那一句 ✓；断点上的那一句 ✗，是**最后一个够得着的断点**
 * ✗——一档在 `sm:` 上就换了 ✗，桌面上就是它 ✗。
 */
function heightOfStep(list: string): { phone: number | null; desktop: number | null } {
  const heights = heightsFrom(list)
  const phone = heights.get('') ?? null
  const desktop = heights.get('md') ?? heights.get('sm') ?? phone
  return { phone, desktop }
}

interface Footer {
  rel: string
  line: number
  classes: string
  /** 那一行里的按钮 ✓。 */
  buttons: { line: number; step: string | null }[]
}

const FOOTERS: Footer[] = SOURCES.flatMap((source) =>
  elementTree(source.text)
    .filter((element) => element.name === 'DialogFooter')
    .map((element) => ({
      rel: source.rel,
      line: source.text.slice(0, element.start).split('\n').length,
      classes: classListOfAttrs(element.opening) ?? '',
      buttons: familyOf(element)
        .filter((child) => child.name === 'Button')
        .map((child) => ({
          line: source.text.slice(0, child.start).split('\n').length,
          step: /(?:^|\s)size="([^"]*)"/.exec(child.opening)?.[1] ?? null,
        })),
    })),
)

describe('弹窗底下的按钮行，只有一副样子', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到那些"底下有一行按钮"的弹窗 ✓。
    expect(FOOTERS.length, '一个弹窗的底部行都没找到，这道门禁多半跑在空集上').toBeGreaterThan(20)
    expect(
      FOOTERS.reduce((total, footer) => total + footer.buttons.length, 0),
      '那些底部行里一个按钮都没找到，这道门禁多半跑在空集上',
    ).toBeGreaterThan(40)

    // 认得共享的底部行自己说的那副类名 ✓。
    const shared = sharedFooterClasses()
    expect(shared.length, '认不出共享的底部行说过的那些话').toBeGreaterThan(3)
    expect(shared, '共享的底部行没有说自己在手机上靠左、在桌面上靠右').toContain('sm:justify-end')

    // 认得楼梯上那一档在每种屏幕上多高 ✓。
    const touch = heightOfStep(BUTTON_VARIANTS.get('touch') ?? '')
    expect(touch.phone, '认不出手指尺寸那一档在手机上多高').toBe(FINGER_PX)
    expect(touch.desktop, '认不出手指尺寸那一档在桌面上多高').toBe(36)
    const ordinary = heightOfStep(BUTTON_VARIANTS.get('default') ?? '')
    expect(ordinary.desktop, '认不出平常那一档在桌面上多高').toBe(36)

    // **认得出"这一行说了好几种话"** ✓——不然这道门禁在空集上跑，永远是绿的 ✓。
    const mixed = [
      { rel: 'a.tsx', line: 1, classes: '', buttons: [{ line: 1, step: 'touch' }] },
      { rel: 'b.tsx', line: 1, classes: '', buttons: [{ line: 1, step: 'wide' }] },
    ]
    const steps = new Set(mixed.flatMap((footer) => footer.buttons.map((button) => button.step)))
    expect(steps.size, '认不出"这一行说了好几种话"').toBe(2)
  })

  it('每一行的按钮，说的是同一句话', () => {
    // 二十八个弹窗底下的按钮，说的是同一种话 ✓。
    // 不许靠"不写"来蒙混 ✓——不写就是平常那一档 ✗，而平常那一档在手机上
    // 只有 36px ✗，手指够不着 ✗。
    const offenders: string[] = []
    const said = new Map<string, string[]>()
    for (const footer of FOOTERS) {
      for (const button of footer.buttons) {
        if (!button.step) {
          offenders.push(`${footer.rel}:${button.line}  这个按钮没有说自己是哪一档`)
          continue
        }
        said.set(button.step, [...(said.get(button.step) ?? []), `${footer.rel}:${button.line}`])
      }
    }

    if (said.size > 1) {
      for (const [step, places] of said) {
        offenders.push(`说的是 \`${step}\` 的：${places.length} 处`)
      }
    }

    expect(
      offenders,
      [
        `底下的按钮说了好几种话：${offenders.length} 处`,
        ...offenders,
        '弹窗底下的按钮都是同一种话：手机上是手指尺寸，桌面上是平常的尺寸。',
        '要哪一档就说哪一档（`size="touch"`）——不写就是平常那一档，而它手指够不着。',
      ].join('\n'),
    ).toEqual([])
  })

  it('那一句话，手机上够得着，桌面上是平常的尺寸', () => {
    // 手机上：不低于手指尺寸那一档 ✓。
    // 桌面上：就是平常那一档 ✓——弹窗底下的按钮在桌面上不是特殊的那一个 ✓。
    const finger = FINGER_PX
    const ordinary = heightOfStep(BUTTON_VARIANTS.get('default') ?? '').desktop ?? 0

    const offenders: string[] = []
    for (const footer of FOOTERS) {
      for (const button of footer.buttons) {
        if (!button.step) continue
        const step = heightOfStep(BUTTON_VARIANTS.get(button.step) ?? '')
        if (step.phone === null) {
          offenders.push(`${footer.rel}:${button.line}  这一档 \`${button.step}\` 没有写明多高`)
          continue
        }
        if (step.phone < finger) {
          offenders.push(
            `${footer.rel}:${button.line}  \`${button.step}\` 在手机上只有 ${step.phone}px，手指够不着（要 ${finger}px）`,
          )
        }
        if (step.desktop !== ordinary) {
          offenders.push(
            `${footer.rel}:${button.line}  \`${button.step}\` 在桌面上是 ${step.desktop}px，而平常那一档是 ${ordinary}px`,
          )
        }
      }
    }

    expect(
      offenders,
      [
        `这些按钮在手机上够不着，或者在桌面上不是平常的尺寸：${offenders.length} 处`,
        ...offenders,
        '弹窗底下的按钮：手机上是指头够得着的尺寸，桌面上是平常的尺寸。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享的底部行说过的那些话，调用点不许再说一遍', () => {
    // `flex flex-row sm:flex-row sm:justify-end gap-2` ✗——
    // 共享的那一副它自己已经说了 ✗，调用点再说一遍 ✗，
    // 就是**这一行有两副画法** ✗（改一处、另一处不动 ✗）。
    const shared = sharedFooterClasses()
    const offenders: string[] = []
    for (const footer of FOOTERS) {
      const tokens = footer.classes.split(/\s+/).filter(Boolean)
      for (const token of tokens) {
        if (!shared.includes(token)) continue
        offenders.push(`${footer.rel}:${footer.line}  又写了一遍共享的 \`${token}\``)
      }
    }

    expect(
      offenders,
      [
        `这些地方又写了一遍共享的底部行说过的那些话：${offenders.length} 处`,
        ...offenders,
        '共享的底部行说过的那些话，调用点不用再说一遍。',
      ].join('\n'),
    ).toEqual([])
  })
})
