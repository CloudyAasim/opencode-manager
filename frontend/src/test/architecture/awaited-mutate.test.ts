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

/**
 * `mutation.mutate(variables)` returns void. It starts the request and walks
 * away, which is exactly what you want at an event handler and exactly what you
 * must not do inside a try/finally that means "wait for it, then clean up".
 *
 * A hook that hands out `x: mutation.mutate` alongside `xAsync: mutation.mutateAsync`
 * is offering both on purpose. `await x(...)` picks the one that waits for nothing:
 * the cleanup runs a microtask later while the request is still in flight, so the
 * in-flight flag never actually guards anything and any refetch races the write.
 * McpManager did this in two places - the toggle's busy state lasted no time at
 * all, and deleting a server rewrote the config before the disconnect had run.
 */
// only the declaration name: matching the generic list would break on
// `useMutation<Record<string, () => void>>(...)`, where the first `>`
// belongs to the arrow and the pattern silently stops matching
const MUTATION_DECL = /(?:const|let)\s+(\w+)\s*=\s*useMutation\b/g
const HANDED_OUT = /\b(\w+):\s*(\w+)\.mutate\b(?!Async)/g
const AWAITED = /\bawait\s+(\w+)\s*[.(]/g

/** Names some module hands out as fire-and-forget. */
function fireAndForgetNames(): Map<string, string> {
  const names = new Map<string, string>()
  for (const source of SOURCES) {
    const declared = new Set<string>()
    for (const m of source.text.matchAll(MUTATION_DECL)) declared.add(m[1]!)
    for (const m of source.text.matchAll(HANDED_OUT)) {
      if (declared.has(m[2]!)) names.set(m[1]!, source.rel)
    }
  }
  return names
}

describe('`.mutate` 是发射后不管，不许被 await', () => {
  it('门禁看得见被交出去的 mutate', () => {
    // A rule over a set that is empty passes forever without protecting
    // anything, so the set itself has to be asserted.
    const names = fireAndForgetNames()
    expect(
      [...names.keys()].sort(),
      [
        '这些名字是被交出去的 .mutate，如果一个都没找到，说明量法坏了，不是代码干净：',
        ...[...names.keys()].sort(),
      ].join('\n'),
    ).not.toEqual([])
  })

  it('没有人 await 一个返回 void 的 mutate', () => {
    const names = fireAndForgetNames()
    const offenders: string[] = []
    for (const source of SOURCES) {
      for (const m of source.text.matchAll(AWAITED)) {
        const owner = names.get(m[1]!)
        if (owner) offenders.push(`${source.rel}  await ${m[1]}(...)  [交出于 ${owner}]`)
      }
    }
    expect(
      offenders,
      [
        `这些 await 等的是一个返回 void 的东西：${offenders.length} 处`,
        ...offenders,
        '要等就用 hook 一起交出来的 xxxAsync 版本（mutateAsync）。',
      ].join('\n'),
    ).toEqual([])
  })

  it('没有把 mutateAsync 也当成同一个东西', () => {
    // mutateAsync is the one that returns a promise, so awaiting it is the
    // whole point. The rule keys on `.mutate` and must not reach across to it.
    const names = fireAndForgetNames()
    for (const name of names.keys()) {
      expect(`${name}Async`, `${name} 的 Async 版本应该单独交出去`).not.toBe(name)
    }
  })
})
