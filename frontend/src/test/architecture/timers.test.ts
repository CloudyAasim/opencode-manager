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
 *
 * 而**零件之外** ✗ 还有一半 ✓：**普通模块** ✓（一个 store ✓、
 * 一个 API 包装 ✓、一个 service worker ✓）—— 它们**自己就是自己的寿命** ✓，
 * 所以它们**可以自己安排定时器** ✓，但是 ✗
 * **要么这个模块清得掉它** ✓（它有 `clearTimeout(` ✓），
 * **要么它点着名** ✓（它**非取消不可** ✓）。
 * **一件白扔掉的话** ✗ —— 没有人记得它 ✗，也就没有人能把它收回来 ✗。
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
    'setTimeout(() => {',
    '**它就是那个零件** ✓ —— 全应用 ✗ 只有这里 ✗ 允许自己安排定时器 ✓',
  ],
  [
    'stores/sessionStatusStore.ts',
    'setTimeout(() => {',
    '它是一个 **store** ✓ —— 它的等待 ✓ 是**这个 store 自己的** ✓（store 的寿命 ✓ 就是应用的寿命 ✓）',
  ],
  [
    'lib/download.ts',
    'URL.revokeObjectURL',
    '它要**收回一个 object URL** ✓ —— 早一步 ✗ 下载就断了 ✓，所以它**非取消不可** ✓',
  ],
  [
    'sw.ts',
    'DEFERRED_BATCH_PAUSE_MS',
    'service worker ✗ **批与批之间歇一下** ✓ —— 它**非取消不可** ✓',
  ],
  [
    'sw.ts',
    'setTimeout(() => {',
    'service worker ✗ **延后开始缓存** ✓ —— 它**非取消不可** ✓',
  ],
]

/** 这一处被点名了吗 ✗。 */
function excused(rel: string, line: string): boolean {
  return EXCEPTIONS.some(([file, token]) => file === rel && line.includes(token))
}

/**
 * 这个文件 ✗ 是不是一个**零件** ✓。
 *
 * 零件 ✗ 就是 **React 的组件与钩子** ✓ —— 它有寿命 ✓，
 * 所以它的等待 ✗ 需要一个主人 ✓。而一个普通的模块 ✓
 * （一个 store ✓、一个 API 包装 ✓、一个 service worker ✓）
 * **自己就是自己的寿命** ✓。
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

interface Timer {
  at: number
  line: string
  lineNumber: number
  /** 它是不是一句白扔掉的话 ✓——句柄扔了 ✗ 就没人记得它 ✓。 */
  bare: boolean
}

/** 全局的那一个定时器 ✗，在哪儿 ✓。 */
function timersOf(text: string): Timer[] {
  const found: Timer[] = []
  const patterns = [
    /(?<![\w$.])setTimeout\s*\(/g,
    /(?:window|globalThis)\.setTimeout\s*\(/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const before = text.slice(0, match.index)
      const lineStart = before.lastIndexOf('\n') + 1
      const lineEnd = text.indexOf('\n', match.index)
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
      const lineNumber = before.split('\n').length
      // 句柄在不在 ✓ —— 也就是 ✗ **它有没有被接住** ✓：
      // 交给了某个变量 ✓（`const timer = setTimeout(…)` ✓，
      // 哪怕中间隔着一个三元 ✓），或者存进了某个地方 ✓（`timers.set(id, …)` ✓）。
      const boundary = Math.max(
        before.lastIndexOf(';'),
        before.lastIndexOf('{'),
        before.lastIndexOf('}'),
      )
      const statement = before.slice(boundary + 1)
      const assigned = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=/.test(statement)
      const stored = /\.\w+\s*\(/.test(statement)
      found.push({ at: match.index, line, lineNumber, bare: !assigned && !stored })
    }
  }
  return found.sort((a, b) => a.at - b.at)
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

    const modules = SOURCES.filter((source) => !isPart(source.text))
    expect(modules.length, '一个普通模块都没扫到，这道门禁多半没在看').toBeGreaterThan(50)

    const shared = SOURCES.find((source) => source.rel === SHARED_TIMER)
    expect(shared, '共享的定时器零件不见了').toBeDefined()
    expect(
      timersOf(shared!.text).length,
      '共享的定时器零件自己没有安排定时器，这道门禁多半没在看',
    ).toBeGreaterThan(0)
  })

  it('零件里的等待，只从共享零件来', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (!isPart(source.text)) continue
      if (shadowsSetTimeout(source.text)) continue

      for (const timer of timersOf(source.text)) {
        if (excused(source.rel, timer.line)) continue
        offenders.push(
          `${source.rel}:${timer.lineNumber}  零件里不许自己安排定时器——它只从共享的定时器零件来`,
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

  it('普通模块里的等待，要么清得掉，要么点着名', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (isPart(source.text)) continue
      if (shadowsSetTimeout(source.text)) continue
      const timers = timersOf(source.text)
      if (!timers.length) continue

      const canCancel = /clearTimeout\s*\(/.test(source.text)
      if (canCancel) continue

      for (const timer of timers) {
        if (excused(source.rel, timer.line)) continue
        offenders.push(
          `${source.rel}:${timer.lineNumber}  这个模块的定时器没人能清掉——它要么有把手并被清掉，要么点着名`,
        )
      }
    }

    expect(
      offenders,
      [
        `这些等待没人能清掉：${offenders.length} 处`,
        ...offenders,
        '一个模块要么清得掉它的定时器，要么点名说明它非取消不可。',
      ].join('\n'),
    ).toEqual([])
  })

  it('一件白扔掉的话，谁也不许有', () => {
    // 一个句柄 ✗ 就是"有人记得它" ✓。没有句柄的定时器 ✓
    // 收不回来 ✗，也说不清它属于谁 ✗。
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (shadowsSetTimeout(source.text)) continue

      for (const timer of timersOf(source.text)) {
        if (!timer.bare) continue
        if (excused(source.rel, timer.line)) continue
        offenders.push(`${source.rel}:${timer.lineNumber}  这句定时器没有句柄——没有人记得它`)
      }
    }

    expect(
      offenders,
      [
        `这些定时器没有句柄：${offenders.length} 处`,
        ...offenders,
        '一个句柄就是"有人记得它"——没有句柄的定时器，收不回来。',
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

    for (const [file, token] of EXCEPTIONS) {
      const source = SOURCES.find((candidate) => candidate.rel === file)
      if (!source) {
        offenders.push(`${file}  点名的那个地方不在了`)
        continue
      }
      const count = timersOf(source.text).filter((timer) => timer.line.includes(token)).length
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
