import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * 定时器只有一个零件。
 *
 * 一个零件说"等一会儿" ✓，那个等待 ✗ **没有主人** ✗ 的时候 ✗，
 * 零件没了 ✗ 它还活着 ✗，到点敲一下 ✗ **已经没了的世界** ✗。
 *
 * 这不是理论：72 号那轮 ✗ 全量测试红了两轮 ✓，
 * 红的文件 ✗ 一个都不是自己坏的 ✓，而**所有用例都过了** ✓——
 * 那个错 ✗ 落在 ✗ **已经拆掉的测试环境** ✗ 上 ✗，算在整轮头上 ✓。
 *
 * 所以等待 ✗ 只从**一个**地方来 ✓：`useCancellableTimer` ✓。
 * 它跟它的零件一起走 ✓，**每一把等待都有名字** ✓，
 * **同名的那把** ✓ 替换上一次 ✓，**不同名的两把** ✓ 互不打扰 ✓。
 *
 * 以前 ✗ 有**两种做法** ✓：共享的零件 ✓，和
 * `const timer = setTimeout(…)` ✓ 配一句 `clearTimeout(timer)` ✓。
 * 后者 ✗ 说得没错 ✗，可是**两副脸** ✗ —— 而且 ✗
 * **那个 effect 拥有的等待 ✗ 本来就该是那个 effect 的** ✓，
 * **它并不比零件活得久** ✓ —— 所以它没有理由 ✗ **不归那个零件管** ✗。
 *
 * 于是现在 ✗ **只有一副** ✓：零件里的等待 ✓ 只从共享零件来 ✓。
 * 零件之外的等待 ✓（页面自己刷新 ✓、service worker ✓、
 * 一个普通的模块 ✓）**不归这条管** ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 那个共享零件 ✓。 */
const SHARED_TIMER = 'hooks/use-cancellable-timer.ts'

/**
 * 哪些地方 ✗ **不是**零件的等待 ✓。
 *
 * 每一处 ✗ **点名到文件与那一句** ✓，并且**写清它为什么不是** ✓。
 */
const EXCEPTIONS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'hooks/use-cancellable-timer.ts',
    'setTimeout',
    '**它就是那个零件** ✓ —— 全应用 ✗ 只有这里 ✗ 允许自己安排定时器 ✓',
  ],
  [
    'hooks/useSSE.ts',
    'setTimeout',
    '它等的是**页面自己刷新** ✓（重启服务器之后两秒 ✓）——页面反正要走 ✓，零件没了也没关系 ✓',
  ],
  [
    'stores/sessionStatusStore.ts',
    'setTimeout',
    '它是一个 **store** ✓ —— 它的等待 ✓ 是**这个 store 自己的** ✓（store 的寿命 ✓ 就是应用的寿命 ✓）',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, token: string): boolean {
  return EXCEPTIONS.some(([file, marked]) => file === rel && marked === token)
}

/**
 * 这个文件 ✗ 是不是一个**零件** ✓。
 *
 * 零件 ✗ 就是 **React 的组件与钩子** ✓ —— 它有寿命 ✓，
 * 所以它的等待 ✗ 需要一个主人 ✓。而一个普通的模块 ✓
 * （service worker ✓、一个 store ✓、一个 API 包装 ✓）
 * **自己就是自己的寿命** ✓，它的等待 ✗ **不归这条管** ✓。
 */
function isPart(text: string): boolean {
  return /\buse[A-Z]\w*\s*\(/.test(text)
}

/**
 * 这个文件里的 `setTimeout` ✗ **是不是全局的那一个** ✗。
 *
 * `AddMcpServerDialog` ✗ 有一个叫 `timeout` 的字段 ✓，
 * 它的 setter ✗ 就叫 `setTimeout` ✓——
 * 那个文件里的 `setTimeout('')` ✓ **不是定时器** ✓，
 * 而是**把那个字段清空** ✓。按字面去数 ✗ 会把它算成 ✗ **没人管的等待** ✗。
 */
function shadowsSetTimeout(text: string): boolean {
  return /\[\s*[^,\]]+\s*,\s*setTimeout\s*\]/.test(text)
}

/** 全局的那一个定时器 ✗，在哪儿 ✓。 */
function timerCalls(text: string): number[] {
  const found: number[] = []
  const bare = /(?<![\w$.])setTimeout\s*\(/g
  const qualified = /(?:window|globalThis)\.setTimeout\s*\(/g
  let match: RegExpExecArray | null
  while ((match = bare.exec(text)) !== null) found.push(match.index)
  bare.lastIndex = 0
  while ((match = qualified.exec(text)) !== null) found.push(match.index)
  return found.sort((a, b) => a - b)
}

/** 每一把等待 ✗ 都要有名字 ✓。 */
function unnamedWaits(text: string): string[] {
  const offenders: string[] = []
  for (const match of text.matchAll(/schedule\s*\(\s*(?!['"`])/g)) {
    const line = text.slice(0, match.index).split('\n').length
    offenders.push(`第 ${line} 行`)
  }
  return offenders
}

describe('定时器只有一个零件', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    const parts = SOURCES.filter((source) => isPart(source.text))
    expect(parts.length, '一个零件都没扫到，这道门禁多半没在看').toBeGreaterThan(50)

    const shared = SOURCES.find((source) => source.rel === SHARED_TIMER)
    expect(shared, '共享的定时器零件不见了').toBeDefined()
    expect(
      timerCalls(shared!.text).length,
      '共享的定时器零件自己没有安排定时器，这道门禁多半没在看',
    ).toBeGreaterThan(0)
  })

  it('零件里的等待，只从共享零件来', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (!isPart(source.text)) continue
      if (shadowsSetTimeout(source.text) && source.rel !== SHARED_TIMER) {
        // 这个文件里的 `setTimeout` ✗ **是那个字段的 setter** ✗，不是定时器 ✓。
        const shadowed = /(?<![\w$.])setTimeout\s*\(/.test(source.text)
        if (shadowed && !/(?:window|globalThis)\.setTimeout\s*\(/.test(source.text)) continue
      }

      for (const at of timerCalls(source.text)) {
        if (excused(source.rel, 'setTimeout')) continue
        const line = source.text.slice(0, at).split('\n').length
        offenders.push(
          `${source.rel}:${line}  零件里不许自己安排定时器——它只从共享的定时器零件来`,
        )
      }
    }

    expect(
      offenders,
      [
        `这些零件自己安排了定时器：${offenders.length} 处`,
        ...offenders,
        '等待只从 `@/hooks/use-cancellable-timer` 来。',
      ].join('\n'),
    ).toEqual([])
  })

  it('每一把等待都有名字', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (!isPart(source.text)) continue
      for (const where of unnamedWaits(source.text)) {
        offenders.push(`${source.rel}  ${where}  这一把等待没有名字`)
      }
    }

    expect(
      offenders,
      [
        `这些等待没有名字：${offenders.length} 处`,
        ...offenders,
        '同名的那把替换上一次，不同名的两把互不打扰——所以每一把都要有名字。',
      ].join('\n'),
    ).toEqual([])
  })

  it('一个例外只放过一处', () => {
    // 一个例外 ✗ 如果放过了两处 ✓，那它就不是"例外" ✓，
    // 而是**一条没人读的第二种做法** ✓。
    const offenders: string[] = []

    for (const [file] of EXCEPTIONS) {
      const source = SOURCES.find((candidate) => candidate.rel === file)
      if (!source) {
        offenders.push(`${file}  点名的那个地方不在了`)
        continue
      }
      const count = timerCalls(source.text).length
      if (count !== 1) {
        offenders.push(`${file}  点名的那个例外放过了 ${count} 处`)
      }
    }

    expect(
      offenders,
      [
        `这些例外放过了不止一处：${offenders.length} 处`,
        ...offenders,
        '一个例外只放过一处。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享的那个定时器零件，自己有一个主人', () => {
    const shared = SOURCES.find((source) => source.rel === SHARED_TIMER)
    expect(shared, '共享的定时器零件不见了').toBeDefined()

    expect(
      /clearTimeout\(/.test(shared!.text),
      '共享的定时器零件把自己的定时器漏在外面了',
    ).toBe(true)
  })

  it('从共享零件来的等待，那个零件得是真的', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (!/schedule\s*\(/.test(source.text)) continue
      if (/from\s+['"][^'"]*use-cancellable-timer['"]/.test(source.text)) continue
      offenders.push(`${source.rel}  用了 schedule(…) 却没有从共享零件来`)
    }

    expect(
      offenders,
      [
        `这些等待不是从共享零件来的：${offenders.length} 处`,
        ...offenders,
        '共享的定时器零件是 `@/hooks/use-cancellable-timer`。',
      ].join('\n'),
    ).toEqual([])
  })
})
