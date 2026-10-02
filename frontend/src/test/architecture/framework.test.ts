import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const fileRel = (file: string) => relativeTo(graph, file)

const EXPORTED = /^export (?:const|function) (\w+)/gm

const SOURCES = graph.files.map((file) => ({
  rel: fileRel(file),
  text: fs.readFileSync(file, 'utf8'),
}))

function referenceCount(name: string): number {
  const pattern = new RegExp(`\\b${name}\\b`, 'g')
  return SOURCES.reduce((total, source) => total + (source.text.match(pattern) ?? []).length, 0)
}

describe('框架自身的整洁度', () => {
  it('门禁本身在看 framework/ 里的导出', () => {
    const exports = SOURCES.flatMap((source) =>
      source.rel.startsWith('framework/')
        ? [...source.text.matchAll(EXPORTED)].map((match) => match[1]!)
        : [],
    )
    expect(
      exports.length,
      `只匹配到 ${exports.length} 个 framework 导出，等于什么都没看`,
    ).toBeGreaterThan(20)
  })

  it('框架不导出没人用的东西', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (!source.rel.startsWith('framework/')) continue
      for (const match of source.text.matchAll(EXPORTED)) {
        const name = match[1]!
        // one occurrence is the declaration itself
        if (referenceCount(name) <= 1) {
          offenders.push(`${source.rel}  ->  ${name}`)
        }
      }
    }
    expect(
      offenders,
      [
        `这些 framework 导出除了声明之外没有任何引用：${offenders.length} 处`,
        ...offenders,
        '框架是整个项目里最该没有死代码的地方。',
        '留着的通常不是"还没用"，而是上一轮改造忘了收尾。',
      ].join('\n'),
    ).toEqual([])
  })
})
