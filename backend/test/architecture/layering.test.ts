import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { buildImportGraph, findCycles, relativeTo } from '../helpers/import-graph'

const BACKEND_SRC = path.resolve(__dirname, '../../src')

const graph = buildImportGraph(BACKEND_SRC)

const LAYERS = ['routes', 'services', 'db', 'utils', 'auth', 'types', 'middleware'] as const
type Layer = (typeof LAYERS)[number]

const LEGACY_ROUTE_SHELLING: ReadonlySet<string> = new Set<string>()

const FORBIDDEN_ROUTE_SHELLING = new Set(['child_process', 'node:child_process'])

function routeShellingFiles(): string[] {
  return graph.files
    .filter((file) => layerOf(file) === 'routes')
    .filter((file) =>
      graph.external.some((edge) => edge.from === file && FORBIDDEN_ROUTE_SHELLING.has(edge.spec)),
    )
    .map(fileRel)
    .sort()
}

function layerOf(file: string): Layer | null {
  const segments = relativeTo(graph, file).split('/')
  const first = segments[0]
  return segments.length > 1 && (LAYERS as readonly string[]).includes(first ?? '')
    ? (first as Layer)
    : null
}

function fileRel(file: string): string {
  return relativeTo(graph, file)
}

function valueImports(from: string): string[] {
  return graph.edges.filter((edge) => edge.from === from && !edge.typeOnly).map((edge) => edge.to)
}

function offendingLayers(fromLayer: Layer, forbidden: readonly Layer[]): string[] {
  const offenders: string[] = []
  for (const file of graph.files) {
    if (layerOf(file) !== fromLayer) continue
    for (const target of valueImports(file)) {
      const targetLayer = layerOf(target)
      if (targetLayer && forbidden.includes(targetLayer)) {
        offenders.push(`${fileRel(file)} -> ${fileRel(target)}`)
      }
    }
  }
  return offenders.sort()
}

function render(title: string, offenders: string[]): string {
  if (offenders.length === 0) return `${title}: 0 处违规`
  return [`${title}: ${offenders.length} 处违规`, ...offenders.map((entry) => `  ${entry}`)].join('\n')
}

describe('backend 分层契约', () => {
  it('services 不得依赖 routes', () => {
    const offenders = offendingLayers('services', ['routes'])
    expect(offenders, render('services -> routes', offenders)).toEqual([])
  })

  it('db 不得依赖 services 或 routes', () => {
    const offenders = offendingLayers('db', ['services', 'routes'])
    expect(offenders, render('db -> services|routes', offenders)).toEqual([])
  })

  it('utils 不得依赖业务层', () => {
    const offenders = offendingLayers('utils', ['services', 'routes', 'db', 'auth'])
    expect(offenders, render('utils -> services|routes|db|auth', offenders)).toEqual([])
  })

  it('types 不得依赖业务层', () => {
    const offenders = offendingLayers('types', ['services', 'routes', 'db'])
    expect(offenders, render('types -> services|routes|db', offenders)).toEqual([])
  })

  it('middleware 不得依赖 routes', () => {
    const offenders = offendingLayers('middleware', ['routes'])
    expect(offenders, render('middleware -> routes', offenders)).toEqual([])
  })

  it('routes 不得直接 spawn 子进程', () => {
    const offenders = routeShellingFiles().filter((rel) => !LEGACY_ROUTE_SHELLING.has(rel))
    expect(offenders, render('routes -> child_process', offenders)).toEqual([])
  })

  it('route shelling 遗留清单与实际债务一致', () => {
    const actual = routeShellingFiles()
    const declared = [...LEGACY_ROUTE_SHELLING].sort()
    expect(declared, render('白名单与实际遗留不符', actual)).toEqual(actual)
  })
})

describe('backend 模块图', () => {
  it('不存在循环依赖', () => {
    const offenders = findCycles(graph).map((component) =>
      component.map(fileRel).sort().join(' <-> '),
    )
    expect(offenders, render('循环依赖', offenders)).toEqual([])
  })
})
