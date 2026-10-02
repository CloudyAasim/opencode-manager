import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

/**
 * When the sidebar was removed, three modules went with it and nothing else did:
 * `useSidebarCollapsed` (nothing imported it), `useSidebarAction` (five pages
 * registered listeners, but the only thing that ever dispatched the event was
 * its own test), and `components/ui/sidebar.tsx`. All three still had passing
 * test files, which is exactly what made them look maintained - a green suite
 * around code no user can reach.
 *
 * The import graph already leaves test files out, so a file with no inbound edge
 * is one that only tests import. That is checkable, unlike "is this module
 * covered", which three separate wrong measurements got wrong.
 */
const importedBy = new Set(graph.edges.map((edge) => edge.to))
const zeroInbound = graph.files.filter((file) => !importedBy.has(file))
const zeroInboundRel = zeroInbound.map((file) => relativeTo(graph, file))

/**
 * Things that have no production importer on purpose, and why.
 *
 * Listed one by one rather than by directory. Exempting all of `test/` as a
 * prefix also exempts a file that is not a test at all - which is exactly how
 * this rule was first written, and a probe planted at
 * `test/architecture/__p54orphan.ts` stayed green. There are only four
 * non-test files under `test/`, so they can be named.
 */
const EXEMPT: Record<string, string> = {
  'main.tsx': 'the Vite entry point - an entry point is imported by nothing',
  'sw.ts': 'the service worker is registered by the build, never imported',
  'scripts/localePrune.ts': 'a maintenance script, run from the command line',
  'test/setup.ts': 'loaded by vitest through setupFiles, not imported',
  'test/test-utils.tsx': 'a helper, only tests need it',
  'test/fixtures/opencode-config.ts': 'a fixture, only tests need it',
  'test/architecture/import-graph.ts': 'the scanner the other gates are built on',
}

describe('没有只被测试引用的模块', () => {
  it('门禁看得见东西', () => {
    expect(graph.files.length, '源文件少得可疑，这门禁多半跑在空集上').toBeGreaterThan(300)
  })

  it('豁免清单是真的：每一条都确实没有生产引用', () => {
    // If a file in EXEMPT ever gains a production importer, or the detector
    // stops seeing it, the exemption is stale and would be hiding a real
    // orphan. So the list has to be true, not merely present.
    const stale = Object.keys(EXEMPT).filter((rel) => !zeroInboundRel.includes(rel))
    expect(
      stale,
      [
        '这些豁免项已经不需要了，或者量法看不见它们了：',
        ...stale,
        '删掉对应的豁免行。',
      ].join('\n'),
    ).toEqual([])
    // Not "more than the list": that was only true while dead modules were
    // still padding the set. The point is that the detector sees at least the
    // declared entries - a blind detector still fails, at zero.
    expect(
      zeroInboundRel.length,
      '零入边的文件数变了，量法或豁免清单要跟着看',
    ).toBeGreaterThanOrEqual(Object.keys(EXEMPT).length)
  })

  it('生产模块都被生产代码引用', () => {
    const offenders = zeroInboundRel.filter((rel) => !(rel in EXEMPT))
    expect(
      offenders,
      [
        `这些模块只有测试在引用，生产代码里没有任何人用：${offenders.length} 处`,
        ...offenders,
        '要么删掉（连同它的测试），要么让生产代码真的用起来。',
        '一个只有测试引用的模块，配上一套通过的测试，看起来像是有人在维护。',
        '注意：放在 test/ 目录里不构成豁免 —— 按目录豁免会让任何非测试文件藏进去。',
      ].join('\n'),
    ).toEqual([])
  })
})
