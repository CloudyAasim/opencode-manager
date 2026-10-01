import fs from 'node:fs'
import path from 'node:path'

export interface ImportEdge {
  from: string
  to: string
  typeOnly: boolean
}

export interface ExternalImport {
  from: string
  spec: string
  typeOnly: boolean
}

export interface ImportGraph {
  root: string
  files: string[]
  edges: ImportEdge[]
  external: ExternalImport[]
}

const SOURCE_EXT = ['.ts', '.tsx']
const IGNORED_DIR = 'node_modules'

const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm
const BARE_IMPORT = /^[ \t]*import\s*['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim()
  if (trimmed.startsWith('type ')) return true
  const braces = trimmed.match(/\{([\s\S]*)\}/)
  if (!braces) return false
  const bindings = (braces[1] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (bindings.length === 0) return false
  return bindings.every((binding) => binding.startsWith('type '))
}

function parseSpecifiers(source: string): Array<{ spec: string; typeOnly: boolean }> {
  const found: Array<{ spec: string; typeOnly: boolean }> = []
  const seen = new Set<string>()
  const push = (spec: string, typeOnly: boolean) => {
    if (!spec) return
    const key = `${typeOnly ? 't' : 'v'}|${spec}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ spec, typeOnly })
  }

  STATIC_IMPORT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STATIC_IMPORT.exec(source)) !== null) {
    push(match[3]!, match[1] !== undefined || isTypeOnlyClause(match[2]!))
  }
  BARE_IMPORT.lastIndex = 0
  while ((match = BARE_IMPORT.exec(source)) !== null) {
    push(match[1]!, false)
  }
  DYNAMIC_IMPORT.lastIndex = 0
  while ((match = DYNAMIC_IMPORT.exec(source)) !== null) {
    push(match[1]!, false)
  }
  return found
}

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === IGNORED_DIR) continue
        walk(path.join(dir, entry.name))
        continue
      }
      const full = path.join(dir, entry.name)
      if (!SOURCE_EXT.some((ext) => entry.name.endsWith(ext))) continue
      if (entry.name.endsWith('.d.ts')) continue
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue
      out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

function candidatePaths(base: string): string[] {
  return [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
}

export function buildImportGraph(root: string, aliases: Array<[string, string]> = []): ImportGraph {
  const files = listSourceFiles(root)
  const known = new Set(files)
  const edges: ImportEdge[] = []
  const external: ExternalImport[] = []

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const { spec, typeOnly } of parseSpecifiers(source)) {
      let target: string | null = null
      let isLocal = false
      for (const [prefix, base] of aliases) {
        if (spec !== prefix && !spec.startsWith(`${prefix}/`)) continue
        const rest = spec.slice(prefix.length).replace(/^\/+/, '')
        target = path.join(base, rest)
        isLocal = true
        break
      }
      if (!target && spec.startsWith('.')) {
        target = path.resolve(path.dirname(file), spec)
        isLocal = true
      }
      if (!isLocal) {
        external.push({ from: file, spec, typeOnly })
        continue
      }
      const resolved = candidatePaths(path.normalize(target!)).find((candidate) => known.has(candidate))
      if (!resolved) {
        external.push({ from: file, spec, typeOnly })
        continue
      }
      edges.push({ from: file, to: resolved, typeOnly })
    }
  }

  return { root, files, edges, external }
}

export function findCycles(graph: ImportGraph): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const file of graph.files) adjacency.set(file, [])
  for (const edge of graph.edges) adjacency.get(edge.from)?.push(edge.to)

  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  let counter = 0

  for (const root of graph.files) {
    if (index.has(root)) continue
    index.set(root, counter)
    low.set(root, counter)
    counter += 1
    stack.push(root)
    onStack.add(root)

    const work: Array<{ node: string; cursor: number }> = [{ node: root, cursor: 0 }]
    const neighbours = adjacency.get(root) ?? []

    while (work.length > 0) {
      const frame = work[work.length - 1]!
      const list = adjacency.get(frame.node) ?? []
      if (frame.cursor < list.length) {
        const next = list[frame.cursor]!
        frame.cursor += 1
        if (!index.has(next)) {
          index.set(next, counter)
          low.set(next, counter)
          counter += 1
          stack.push(next)
          onStack.add(next)
          work.push({ node: next, cursor: 0 })
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!))
        }
        continue
      }
      work.pop()
      const parent = work[work.length - 1]
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!))
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = []
        for (;;) {
          const popped = stack.pop()!
          onStack.delete(popped)
          component.push(popped)
          if (popped === frame.node) break
        }
        if (component.length > 1) cycles.push(component)
        else if ((adjacency.get(component[0]!) ?? []).includes(component[0]!)) cycles.push(component)
      }
    }
    void neighbours
  }

  return cycles
}

export function relativeTo(graph: ImportGraph, file: string): string {
  return path.relative(graph.root, file).split(path.sep).join('/')
}
