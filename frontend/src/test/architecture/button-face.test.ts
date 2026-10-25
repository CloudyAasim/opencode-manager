import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { classListOfAttrs, stripComments, tagAt, variantsOf } from './source-text'

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
    for (const name of ['default', 'outline', 'ghost']) {
      expect(VARIANTS.has(name), `共享的按钮没有 ${name} 那一档`).toBe(true)
    }

    // 认得那一档说过的每一个词 ✓。
    const outline = saidBy('outline')
    expect(outline.has('border-border'), '认不出 outline 那一档的边框').toBe(true)
    expect(outline.has('hover:bg-accent'), '认不出 outline 那一档的悬停').toBe(true)
    expect(saidBy('default').has('bg-primary'), '认不出 default 那一档的背景').toBe(true)

    // 找得到调用点 ✓。
    expect(CALL_SITES.length, '一个按钮的调用点都没找到，这道门禁多半跑在空集上').toBeGreaterThan(100)

    // **认得出"同一句话说了两遍"** ✓——不然这道门禁在空集上跑，永远是绿的 ✓。
    const repeated = [
      'bg-primary',
      'hover:bg-primary-hover',
      'text-primary-foreground',
    ].filter((token) => saidBy('default').has(token))
    expect(repeated.length, '认不出"同一句话说了两遍"').toBe(3)
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
})
