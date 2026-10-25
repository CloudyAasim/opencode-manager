import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, stripComments, tagAt } from './source-text'

/**
 * 高度只有那道楼梯说了算。
 *
 * 共享的按钮和共享的字段，各自写明了自己在每一档屏幕上多高 ✓——
 * 42 号那轮把**刻度**上的高度统一了 ✓（`h-8` 是 32 ✓、`h-9` 是 36 ✓），
 * 门禁也管住了调用点写 `h-8` ✗ 和写 `sm:h-7` ✗ 的两种写法 ✓。
 *
 * 可是还有**第三种写法** ✗，两道门禁都看不见它 ✗：
 *
 * ```
 * <Button className="min-h-[44px]" />
 * <Input  className="min-h-[44px]" />
 * ```
 *
 * `min-h-[44px]` ✗ 不是刻度上的任何一档 ✗，它**自己写了高度** ✗——
 * 于是那个按钮在手机上是 44px ✓，在桌面上还是 44px ✗，
 * 而共享的零件说的是另一件事 ✗。**没有人比过它** ✗——
 * 门禁只认 `h-8` 那种写法 ✗，于是它从门前走了过去 ✗。
 *
 * 所以这一轮：
 *
 * - **调用点不许写自己写的高度** ✓：刻度上的 ✗（两道旧门禁在管 ✓）、
 *   自己写的 ✗（`min-h-[44px]` ✓、`h-[36px]` ✓）、占满那块地方的 ✗
 *   （`h-full` ✓）——**都不许** ✓。
 * - **一个多行框要多高，是那个框自己的事** ✓：它要放几行字 ✓，
 *   要占满对话框给的那块地方 ✓——这两个是它的事 ✓，不是楼梯的事 ✓。
 *
 * 判的是**形状**：一个共享零件的调用点 ✓、它自己写的那一串类名 ✓、
 * 以及那些类名里**不是刻度**的高度 ✓。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/** 共享的那些零件 ✓。 */
const SHARED_PARTS = ['Button', 'Input', 'SelectTrigger', 'Textarea']

/**
 * 一串类名里，自己写的高度。
 *
 * 刻度上的那种（`h-8` ✓）由两道旧门禁在管 ✓；这里管的是**没人管的那几种**：
 * 自己写的一个数（`min-h-[44px]` ✓）和"占满那块地方"（`h-full` ✓）。
 */
function ownHeights(list: string): string[] {
  const found: string[] = []
  for (const token of list.split(/\s+/)) {
    if (!token) continue
    if (/^(?:[a-z0-9]+:)?(?:min-|max-)?(?:h|size)-\[/.test(token)) {
      found.push(token)
      continue
    }
    if (/^(?:[a-z0-9]+:)?(?:min-|max-)?(?:h|size)-(?:full|none|0)$/.test(token)) {
      found.push(token)
    }
  }
  return found
}

/**
 * 一个多行框可以自己说的那两句。
 *
 * `min-h-[…]` ✓：它要放几行字 ✓；`h-full` ✓ 和 `min-h-0` ✓：
 * 它要占满对话框给的那块地方 ✓。
 */
function ownHeightAllowed(part: string, token: string): boolean {
  if (part !== 'Textarea') return false
  if (/^(?:[a-z0-9]+:)?min-h-/.test(token)) return true
  if (/^(?:[a-z0-9]+:)?h-full$/.test(token)) return true
  return false
}

interface CallSite {
  rel: string
  line: number
  part: string
  list: string
}

function callSites(): CallSite[] {
  const found: CallSite[] = []
  for (const source of SOURCES) {
    for (const part of SHARED_PARTS) {
      const matcher = new RegExp(`<${part}\\b`, 'g')
      let match: RegExpExecArray | null
      while ((match = matcher.exec(source.text)) !== null) {
        const opening = tagAt(source.text, match.index)
        const attrs = opening.slice(part.length + 1, opening.endsWith('>') ? -1 : undefined)
        found.push({
          rel: source.rel,
          line: source.text.slice(0, match.index).split('\n').length,
          part,
          list: classListOfAttrs(attrs) ?? '',
        })
      }
    }
  }
  return found
}

const CALL_SITES = callSites()

describe('高度只有那道楼梯说了算', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)

    // 找得到共享零件的调用点 ✓。
    expect(CALL_SITES.length, '一个共享零件的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(50)

    // **认得出"自己写的高度"** ✓——不然这道门禁在空集上跑，永远是绿的 ✓。
    expect(ownHeights('min-h-[44px] flex-1'), '认不出自己写的一个数').toEqual(['min-h-[44px]'])
    expect(ownHeights('h-full min-h-0'), '认不出占满那块地方').toEqual(['h-full', 'min-h-0'])
    expect(ownHeights('h-8 sm:h-9 px-2'), '把刻度上的高度当成了自己写的').toEqual([])
    expect(ownHeights('w-full max-w-[80px]'), '把宽度当成了高度').toEqual([])

    // 认得那句"一个多行框可以自己说的" ✓。
    expect(ownHeightAllowed('Textarea', 'min-h-[200px]'), '不认多行框的最小高度').toBe(true)
    expect(ownHeightAllowed('Textarea', 'h-full'), '不认多行框占满那块地方').toBe(true)
    expect(ownHeightAllowed('Button', 'min-h-[44px]'), '认按钮也能自己写高度了').toBe(false)
    expect(ownHeightAllowed('Input', 'h-full'), '认字段也能占满那块地方了').toBe(false)
  })

  it('调用点不许写自己写的高度', () => {
    const offenders: string[] = []
    for (const site of CALL_SITES) {
      for (const token of ownHeights(site.list)) {
        if (ownHeightAllowed(site.part, token)) continue
        offenders.push(`${site.rel}:${site.line}（${site.part}）  ${token}`)
      }
    }

    expect(
      offenders,
      [
        `这些地方自己写了高度：${offenders.length} 处`,
        ...offenders,
        '共享的零件有多高是共享的事：调用点要哪一档，就说哪一档（`size="lg"`）。',
        '一个多行框要多高、要不要占满那块地方，是那个框自己的事。',
      ].join('\n'),
    ).toEqual([])
  })
})
