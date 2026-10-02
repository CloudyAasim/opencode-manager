import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { KNOWN_LAYERS } from '@/framework/layer/knownLayers'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

const USERS = SOURCES.filter((s) => /\buseLayer\(/.test(s.text) && !s.rel.startsWith('framework/layer/'))

/** The name each call site passes. One of them is a constant, so resolve it
 *  from the file that declares it rather than pretending it is a literal. */
function layerNamesIn(rel: string, text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/\buseLayer\(\s*'([A-Za-z][\w-]*)'/g)) {
    names.push(match[1]!)
  }
  for (const match of text.matchAll(/\buseLayer\(\s*([A-Z][A-Z0-9_]*)\s*\)/g)) {
    const constant = new RegExp(
      `${match[1]!}\\s*=\\s*'([A-Za-z][\\w-]*)'`,
    ).exec(SOURCES.map((s) => s.text).join('\n'))
    if (!constant) {
      throw new Error(`${rel}: useLayer(${match[1]}) 的值找不到`)
    }
    names.push(constant[1]!)
  }
  return names
}

const DECLARED_IN_SOURCE = new Set(USERS.flatMap((s) => layerNamesIn(s.rel, s.text)))

/**
 * LayerProvider seeds its stack from ?dialog=<name>, so the address bar can
 * put a layer into the app that no component renders. That used to be taken
 * at face value: believed, kept in the stack, and written straight back, so
 * the URL said a dialog was open while nothing was on screen, and the
 * phantom stayed underneath every dialog opened afterwards.
 *
 * KNOWN_LAYERS is the list that makes a name either a real layer or nothing.
 * This gate is what keeps that list equal to the call sites, in both
 * directions - a name used but not listed would be rejected by the provider
 * and silently stop working, and a listed name with no call site would
 * reintroduce the phantom for that one name.
 */
describe('已知层名与真实的调用点一致', () => {
  it('门禁自己看得见东西', () => {
    expect(USERS.length, '一个 useLayer 调用点都没扫到').toBeGreaterThan(3)
    expect(KNOWN_LAYERS.size, 'KNOWN_LAYERS 是空的').toBeGreaterThanOrEqual(5)
  })

  it('每个 useLayer 的层名都在清单里，否则 provider 会把它当幻影丢掉', () => {
    const missing = [...DECLARED_IN_SOURCE].filter((name) => !KNOWN_LAYERS.has(name))
    expect(
      missing,
      `这些层被使用了却不在 KNOWN_LAYERS 里，它们会被 provider 当成幻影：${missing.join(', ')}`,
    ).toEqual([])
  })

  it('清单里没有没人用的层名，否则它又是一个可以写进 URL 的幻影', () => {
    const extra = [...KNOWN_LAYERS].filter((name) => !DECLARED_IN_SOURCE.has(name))
    expect(extra, `KNOWN_LAYERS 里有没有任何组件在用的层：${extra.join(', ')}`).toEqual([])
  })
})
