import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, findCycles, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const LAYERS = ['pages', 'components', 'hooks', 'lib', 'api', 'contexts', 'stores'] as const
type Layer = (typeof LAYERS)[number]

const COMPOSITION_ROOTS: ReadonlySet<string> = new Set([
  'App.tsx',
  'main.tsx',
  'routes.tsx',
  'sw.ts',
])

function layerOf(file: string): Layer | null {
  const segments = relativeTo(graph, file).split('/')
  if (segments.length < 2) return null
  const first = segments[0]
  return (LAYERS as readonly string[]).includes(first ?? '') ? (first as Layer) : null
}

function fileRel(file: string): string {
  return relativeTo(graph, file)
}

function sourceRootFiles(): string[] {
  return graph.files.filter((file) => !fileRel(file).includes('/')).map(fileRel).sort()
}

function offendingLayers(fromLayer: Layer, forbidden: readonly Layer[]): string[] {
  const offenders: string[] = []
  for (const file of graph.files) {
    if (layerOf(file) !== fromLayer) continue
    for (const edge of graph.edges) {
      if (edge.from !== file || edge.typeOnly) continue
      const targetLayer = layerOf(edge.to)
      if (targetLayer && forbidden.includes(targetLayer)) {
        offenders.push(`${fileRel(file)} -> ${fileRel(edge.to)}`)
      }
    }
  }
  return offenders.sort()
}

function barrelSelfImports(): string[] {
  const offenders: string[] = []
  for (const file of graph.files) {
    const rel = fileRel(file)
    if (!rel.startsWith('components/') || !rel.endsWith('.tsx')) continue
    const directory = rel.slice(0, rel.lastIndexOf('/'))
    for (const edge of graph.edges) {
      if (edge.from !== file || edge.typeOnly) continue
      const target = fileRel(edge.to)
      if (target === `${directory}/index.ts` || target === `${directory}/index.tsx`) {
        offenders.push(`${rel} -> ${target}`)
      }
    }
  }
  return offenders.sort()
}

function render(title: string, offenders: string[]): string {
  if (offenders.length === 0) return `${title}: 0 处违规`
  return [`${title}: ${offenders.length} 处违规`, ...offenders.map((entry) => `  ${entry}`)].join('\n')
}

describe('frontend 分层契约', () => {
  it('每一层都真的存在文件', () => {
    const sizes = LAYERS.map((layer) => ({
      layer,
      files: graph.files.filter((file) => layerOf(file) === layer).length,
    }))
    const empty = sizes.filter((entry) => entry.files === 0).map((entry) => entry.layer)
    expect(
      empty,
      [
        `这些层在图里一个文件都没有，对应的规则会空转：${empty.join('、')}`,
        '规则扫不到东西时永远是绿的。',
        ...sizes.map((entry) => `  ${entry.layer.padEnd(10)} ${entry.files} 个文件`),
      ].join('\n'),
    ).toEqual([])
  })


  it('components 不得依赖 pages', () => {
    const offenders = offendingLayers('components', ['pages'])
    expect(offenders, render('components -> pages', offenders)).toEqual([])
  })

  it('lib 不得依赖 React 层', () => {
    const offenders = offendingLayers('lib', ['hooks', 'components', 'pages', 'contexts'])
    expect(offenders, render('lib -> hooks|components|pages|contexts', offenders)).toEqual([])
  })

  it('api 不得依赖 React 层', () => {
    const offenders = offendingLayers('api', ['hooks', 'components', 'pages', 'contexts'])
    expect(offenders, render('api -> hooks|components|pages|contexts', offenders)).toEqual([])
  })

  it('hooks 不得依赖 pages', () => {
    const offenders = offendingLayers('hooks', ['pages'])
    expect(offenders, render('hooks -> pages', offenders)).toEqual([])
  })

  it('stores 不得依赖组件层', () => {
    const offenders = offendingLayers('stores', ['components', 'pages', 'hooks'])
    expect(offenders, render('stores -> components|pages|hooks', offenders)).toEqual([])
  })

  it('contexts 不得依赖 pages', () => {
    const offenders = offendingLayers('contexts', ['pages'])
    expect(offenders, render('contexts -> pages', offenders)).toEqual([])
  })

  it('同目录组件不得经 barrel 回引自身', () => {
    const offenders = barrelSelfImports()
    expect(offenders, render('barrel 自引用', offenders)).toEqual([])
  })

  it('src 根目录只允许已登记的组合根', () => {
    const undeclared = sourceRootFiles().filter((rel) => !COMPOSITION_ROOTS.has(rel))
    expect(undeclared, render('未登记的 src 根目录模块', undeclared)).toEqual([])
  })

  it('已登记的组合根都还在', () => {
    const actual = sourceRootFiles()
    const declared = [...COMPOSITION_ROOTS].sort()
    expect(declared, render('组合根清单与实际不符', actual)).toEqual(actual)
  })
})

const TOKEN_ONLY_PREFIXES = ['framework/']

const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|shadow|accent|caret|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

describe('frontend 设计令牌', () => {
  it('新代码不得使用 Tailwind 原生色板，只能用语义令牌', () => {
    const offenders: string[] = []
    for (const file of graph.files) {
      const rel = fileRel(file)
      if (!TOKEN_ONLY_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue
      const source = fs.readFileSync(file, 'utf8')
      if (!RAW_PALETTE.test(source)) continue
      const lines = source.split('\n')
      lines.forEach((line, index) => {
        if (RAW_PALETTE.test(line)) offenders.push(`${rel}:${index + 1}  ${line.trim()}`)
      })
    }
    expect(offenders, render('新代码使用了原生色板', offenders)).toEqual([])
  })
})

const CROSS_FEATURE_DIALOG: ReadonlySet<string> = new Set([
  'features/repos/RepoMcpDialog.tsx -> features/settings/McpOAuthDialog.tsx',
  'features/repos/RepoSkillsDialog.tsx -> features/settings/SkillInstallDialog.tsx',
  'features/navigation/MobileSheetHost.tsx -> features/file-browser/FileBrowserSheet.tsx',
  'features/navigation/RepoQuickSwitchSheet.tsx -> features/repos/AddRepoDialog.tsx',
  'features/source-control/BranchesTab.tsx -> features/repos/CreateWorktreeDialog.tsx',
  'features/repos/RepoRowActions.tsx -> features/source-control/SourceControlPanel.tsx',
  // The repo overlay cluster is mounted from one place so the five
  // pages and features that used to wire it by hand cannot drift apart.
  'features/repos/RepoOverlays.tsx -> features/file-browser/FileBrowserSheet.tsx',
  'features/repos/RepoOverlays.tsx -> features/source-control/index.ts',
])

const MIGRATION_BACK_REFERENCE_BASELINE = 0

const MIGRATED_FEATURE_DIRS: ReadonlySet<string> = new Set([
  'file-browser',
  'message',
  'navigation',
  'notifications',
  'repos',
  'session',
  'schedules',
  'settings',
  'source-control',
  'ssh',
  'terminal',
])

function featureOwner(rel: string): string | null {
  return rel.startsWith('features/') ? rel.split('/')[1]! : null
}

function backReferencesFromLegacy(): string[] {
  const found: string[] = []
  for (const file of graph.files) {
    const from = fileRel(file)
    if (!from.startsWith('components/')) continue
    for (const edge of graph.edges) {
      if (edge.from !== file || edge.typeOnly) continue
      const to = fileRel(edge.to)
      if (!to.startsWith('features/')) continue
      found.push(`${from} -> ${to}`)
    }
  }
  return found.sort()
}

const FEATURE_RULES: ReadonlyArray<readonly [string, (from: string, to: string) => boolean]> = [
  [
    'framework 不得依赖 feature',
    (from, to) => !from.startsWith('framework/') || !to.startsWith('features/'),
  ],
  [
    'feature 不得横向依赖另一个 feature',
    (from, to) => {
      const source = featureOwner(from)
      const target = featureOwner(to)
      if (source === null || target === null) return true
      return source === target
    },
  ],
]

describe('frontend feature 边界', () => {
  it.each(FEATURE_RULES)('%s', (_label, allow) => {
    const offenders: string[] = []
    for (const file of graph.files) {
      const from = fileRel(file)
      for (const edge of graph.edges) {
        if (edge.from !== file || edge.typeOnly) continue
        const to = fileRel(edge.to)
        if (allow(from, to)) continue
        if (CROSS_FEATURE_DIALOG.has(`${from} -> ${to}`)) continue
        offenders.push(`${from} -> ${to}`)
      }
    }
    expect(offenders, render(_label, offenders)).toEqual([])
  })

  it('已迁移的 feature 不得在旧树复活', () => {
    const revived = [...MIGRATED_FEATURE_DIRS]
      .filter((name) => fs.existsSync(path.join(FRONTEND_SRC, 'components', name)))
      .sort()
    expect(revived, render('旧树中复活的 feature 目录', revived)).toEqual([])
  })

  it('旧 components 不得新增对 feature 的反向依赖', () => {
    const back = backReferencesFromLegacy()
    expect(
      back.length,
      [
        `旧树反向依赖 feature：${back.length} 条，上限 ${MIGRATION_BACK_REFERENCE_BASELINE}`,
        ...back.map((entry) => `  ${entry}`),
        '每迁移完一个 feature，这条基线应当下调。',
      ].join('\n'),
    ).toBeLessThanOrEqual(MIGRATION_BACK_REFERENCE_BASELINE)
  })
})

describe('frontend 模块图', () => {
  it('不存在循环依赖', () => {
    const offenders = findCycles(graph).map((component) =>
      component.map(fileRel).sort().join(' <-> '),
    )
    expect(offenders, render('循环依赖', offenders)).toEqual([])
  })
})
