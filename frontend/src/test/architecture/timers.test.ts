import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * 定时器不越过它的零件。
 *
 * 一个零件说"等一会儿" ✓，那个等待 ✗ **比它的零件活得久** ✗ 的时候 ✗，
 * 等待响的那一刻 ✗ **那个世界已经没有了** ✗——于是 ✗ 一次 `setState` ✗
 * 打在 ✗ **已经拆掉的测试环境** ✗ 上 ✗，报出来的是
 * `window is not defined` ✗，**算在那个文件头上** ✗，
 * 而**那个文件一条用例都没红** ✗。
 *
 * 这不是理论：72 号那轮 ✗ 全量测试红了两轮 ✓，
 * 红的文件 ✗ 一个都不是自己坏的 ✓。
 *
 * 所以等待 ✗ 要有一个**主人** ✓。而"主人"这件事 ✗ 只跟 ✗
 * **零件自己的东西** ✗ 有关 ✓：
 *
 * - **它会碰到零件自己的状态** ✓（`useState` 的那个 setter ✓），
 *   或者**它自己的那个 ref** ✓——那么它就**是这个零件的等待** ✓，
 *   零件没了 ✗ 它就该跟着没 ✓；
 * - 它做的是 ✗ **零件之外的事** ✓（把页面刷新一遍 ✓、
 *   把一个 object URL 收回来 ✓、滚动一下 ✓）——
 *   那种等待 ✗ **不归零件管** ✓，也就**不需要主人** ✓。
 *
 * 主人有两种 ✓：
 *
 * - **从共享零件来** ✓——`useCancellableTimer` ✓，它跟它的零件一起走 ✓；
 * - **或者自己有个把手 ✓，而那个把手被清掉 ✓**——
 *   `const timer = setTimeout(…)` ✓ 配 `clearTimeout(timer)` ✓。
 *
 * **没有把手的定时器 ✗ 是最糟的那一种** ✗：它没人管 ✓，
 * 谁也不知道它在哪儿 ✓，它就在那儿等着 ✓。
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
 * 这个文件里的 `setTimeout` ✗ **是不是全局的那一个** ✗。
 *
 * `AddMcpServerDialog` ✗ 有一个叫 `timeout` 的字段 ✓，
 * 它的 setter ✗ 就叫 `setTimeout` ✓——
 * 于是那个文件里的 `setTimeout('')` ✓ **不是定时器** ✓，
 * 而是**把那个字段清空** ✓。
 * 按字面去数 ✗ 会把它当成一个 ✗ **没人管的定时器** ✗。
 */
function shadowsSetTimeout(text: string): boolean {
  return /\[\s*[^,\]]+\s*,\s*setTimeout\s*\]/.test(text)
}

/** 零件自己的那些名字 ✓——`useState` 的 setter ✓ 和 `useRef` 的那个 ref ✓。 */
function ownNames(text: string): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(/\[\s*[^,\]]*\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\b/g)) {
    names.add(match[1]!)
  }
  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*useRef\b/g)) {
    names.add(match[1]!)
  }
  return names
}

/** 一个调用 ✗ 的第一个参数 ✓，也就是那个回调 ✓。 */
function firstArgument(text: string, openAt: number): string {
  let depth = 0
  let quote: string | null = null
  let comma = -1
  for (let index = openAt; index < text.length; index += 1) {
    const char = text[index]!
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(' || char === '{' || char === '[') {
      depth += 1
      continue
    }
    if (char === ')' || char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) {
        return comma < 0 ? text.slice(openAt + 1, index) : text.slice(openAt + 1, comma)
      }
      continue
    }
    if (char === ',' && depth === 1 && comma < 0) comma = index
  }
  return text.slice(openAt + 1)
}

/** 这个回调 ✗ 碰没碰到 ✗ **零件自己的东西** ✓。 */
function touchesOwnThings(callback: string, names: Set<string>): boolean {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`).test(callback)) return true
  }
  return false
}

/** 那个回调 ✗ 前面的把手 ✗。 */
function handleBefore(text: string, at: number): string | null {
  const before = text.slice(Math.max(0, at - 160), at)
  const assigned = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*[^=]*$/.exec(before)
  return assigned ? assigned[1]! : null
}

/** 这个把手 ✗ 有没有被清掉 ✓。 */
function handleIsCleared(text: string, handle: string): boolean {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`clearTimeout\\(\\s*${escaped}\\s*\\)`).test(text)
}

/** 这个文件 ✗ 用的是不是共享的那个定时器零件 ✓。 */
function usesSharedTimer(text: string): boolean {
  return /from\s+['"][^'"]*use-cancellable-timer['"]/.test(text)
}

interface Wait {
  at: number
  handle: string | null
  callback: string
}

function waitsIn(source: { text: string }): Wait[] {
  const found: Wait[] = []
  const patterns = [
    /(?<![\w$.])setTimeout\s*\(/g,
    /(?:window|globalThis)\.setTimeout\s*\(/g,
    /(?<![\w$.])schedule\s*\(/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source.text)) !== null) {
      const openAt = source.text.indexOf('(', match.index)
      if (openAt < 0) continue
      found.push({
        at: match.index,
        handle: pattern.source.includes('schedule') ? null : handleBefore(source.text, match.index),
        callback: firstArgument(source.text, openAt),
      })
    }
  }
  return found.sort((a, b) => a.at - b.at)
}

describe('定时器不越过它的零件', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    const waits = SOURCES.flatMap((source) => waitsIn(source))
    expect(waits.length, '一个等待都没扫到，这道门禁多半没在看').toBeGreaterThan(10)

    // 门禁 ✗ **两种形状都看得见** ✓——
    // 共享零件来的 ✓，和**自己安排、自己清掉**的 ✓。
    const sharedCalls = SOURCES.reduce(
      (total, source) => total + (source.text.match(/schedule\s*\(/g)?.length ?? 0),
      0,
    )
    expect(sharedCalls, '从共享零件来的等待一个都没扫到，这道门禁多半只看得见一种形状').toBeGreaterThan(0)
  })

  it('每个碰到零件自己东西的等待都有主人', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      const names = ownNames(source.text)
      if (names.size === 0) continue
      const shadowed = shadowsSetTimeout(source.text)

      for (const wait of waitsIn(source)) {
        const isShared = /schedule\s*\(/.test(source.text.slice(wait.at, wait.at + 12))
        // 这个文件里的 `setTimeout` ✗ **是那个字段的 setter** ✗，不是定时器 ✓。
        if (shadowed && !isShared && !/^(?:window|globalThis)\./.test(source.text.slice(wait.at, wait.at + 20))) {
          continue
        }
        if (!touchesOwnThings(wait.callback, names)) continue

        const line = source.text.slice(0, wait.at).split('\n').length

        if (isShared) {
          if (!usesSharedTimer(source.text)) {
            offenders.push(`${source.rel}:${line}  用了 schedule(…) 却没有从共享的定时器零件来`)
          }
          continue
        }

        if (wait.handle === null) {
          offenders.push(`${source.rel}:${line}  这个等待没有把手——没有人知道它在哪儿，也没有人能把它清掉`)
          continue
        }

        if (!handleIsCleared(source.text, wait.handle)) {
          offenders.push(
            `${source.rel}:${line}  等待的把手 ${wait.handle} 没有被清掉——它比它的零件活得久`,
          )
        }
      }
    }

    expect(
      offenders,
      [
        `这些等待没有主人：${offenders.length} 处`,
        ...offenders,
        '等待要么从共享零件来（useCancellableTimer），要么自己有个被清掉的把手。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享的那个定时器零件，自己有一个主人', () => {
    const shared = SOURCES.find((source) => source.rel === SHARED_TIMER)
    expect(shared, '共享的定时器零件不见了').toBeDefined()

    const timers = waitsIn(shared!).filter(
      (wait) => !/schedule\s*\(/.test(shared!.text.slice(wait.at, wait.at + 12)),
    )
    expect(timers.length, '共享的定时器零件自己没有安排定时器').toBeGreaterThan(0)
    for (const timer of timers) {
      expect(
        timer.handle !== null && handleIsCleared(shared!.text, timer.handle!),
        '共享的定时器零件把自己的定时器漏在外面了',
      ).toBe(true)
    }
  })

  it('从共享零件来的等待，那个零件得是真的', () => {
    const offenders: string[] = []

    for (const source of SOURCES) {
      if (!/schedule\s*\(/.test(source.text)) continue
      if (usesSharedTimer(source.text)) continue
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
