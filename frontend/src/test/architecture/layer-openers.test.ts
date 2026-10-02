import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

const APP = SOURCES.filter((source) => !source.rel.startsWith('test/') && !source.rel.includes('.test.'))

// useLayer('name') destructured into [open, setOpen]
const READ = /const\s*\[([^\],]+),\s*(\w+)\]\s*=\s*useLayer\('([^']+)'\)/g
// a component that only wants the value
const READ_ONLY = /const\s*\[\s*,\s*(\w+)\]\s*=\s*useLayer\('([^']+)'\)/g
// A layer can also be opened by putting its name in the ?dialog= parameter -
// LayerProvider seeds the whole stack from it and syncs back. Counting only
// setX() calls once made me conclude a dialog was unreachable when the drawer
// reached it exactly this way.
const VIA_URL = /dialog:\s*'([^']+)'/g

function layers(): Map<string, { readers: string[]; openers: string[] }> {
  const found = new Map<string, { readers: string[]; openers: string[] }>()
  const entry = (name: string) => {
    const current = found.get(name) ?? { readers: [], openers: [] }
    found.set(name, current)
    return current
  }
  for (const source of APP) {
    for (const match of source.text.matchAll(READ)) {
      const [, value, setter, name] = match
      const record = entry(name!)
      record.readers.push(source.rel)
      if (new RegExp(`\\b${setter}\\s*\\(`).test(source.text)) record.openers.push(source.rel)
      void value
    }
    for (const match of source.text.matchAll(READ_ONLY)) {
      const [, setter, name] = match
      const record = entry(name!)
      record.readers.push(source.rel)
      if (new RegExp(`\\b${setter}\\s*\\(`).test(source.text)) record.openers.push(source.rel)
    }
  }
  for (const source of APP) {
    for (const match of source.text.matchAll(VIA_URL)) {
      entry(match[1]!).openers.push(source.rel)
    }
  }
  return found
}

describe('每层都得有人打开', () => {
  it('门禁扫到了 layer 的使用', () => {
    expect(layers().size, '一层都没扫到，规则可能在空集上跑').toBeGreaterThan(4)
  })

  it('没有谁都打不开的层', () => {
    const dead = [...layers().entries()]
      .filter(([, record]) => record.openers.length === 0)
      .map(([name, record]) => `${name}  <- ${record.readers.join(', ')}`)

    expect(
      dead,
      [
        `这些层有人读、没人写，也就是挂着一个永远打不开的弹层：${dead.length} 处`,
        ...dead,
        '读它的地方只配了层，没有 setX(...) 调用，',
        '也没有任何地方用 ?dialog=<name> 把它打开。',
        '要么给它一个入口，要么把弹层删掉——挂着打不开的东西只是把债务藏起来。',
      ].join('\n'),
    ).toEqual([])
  })
})
