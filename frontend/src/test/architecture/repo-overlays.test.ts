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

// The six overlays a page sitting on one repository mounts. They used to be
// wired by hand in every page that wanted them, which is how the file browser
// ended up with three different prop sets.
const OWNER = 'features/repos/RepoOverlays.tsx'

const OVERLAYS: ReadonlyArray<{ tag: string; alsoAllowed: readonly string[] }> = [
  // A row action opens it for one repo, not for the page's repo context.
  { tag: 'SourceControlPanel', alsoAllowed: ['features/repos/RepoRowActions.tsx'] },
  { tag: 'ResetPermissionsDialog', alsoAllowed: [] },
  { tag: 'RepoLspDialog', alsoAllowed: [] },
  { tag: 'RepoMcpDialog', alsoAllowed: [] },
  { tag: 'RepoSkillsDialog', alsoAllowed: [] },
  // Three different things: the workspace root (Repos.tsx) and the two
  // navigation sheets. None of them is a repo-context overlay.
  {
    tag: 'FileBrowserSheet',
    alsoAllowed: [
      'pages/Repos.tsx',
      'features/navigation/MobileSheetHost.tsx',
      'features/navigation/MoreDrawer.tsx',
    ],
  },
]

function mountedOutside(): string[] {
  const offenders: string[] = []
  for (const source of SOURCES) {
    if (source.rel === OWNER) continue
    for (const { tag, alsoAllowed } of OVERLAYS) {
      if (alsoAllowed.includes(source.rel)) continue
      if (new RegExp(`<${tag}[\\s/>]`).test(source.text)) {
        offenders.push(`${source.rel} -> <${tag}>`)
      }
    }
  }
  return offenders
}

describe('仓库弹层只有一处装配', () => {
  it('门禁看得见它要守的那些弹层', () => {
    expect(SOURCES.length, '源码没扫到').toBeGreaterThan(200)
    const owner = SOURCES.find((source) => source.rel === OWNER)
    expect(owner, `找不到 ${OWNER}`).toBeDefined()
    const mounted = OVERLAYS.filter(({ tag }) => new RegExp(`<${tag}[\\s/>]`).test(owner!.text))
    expect(mounted.map((entry) => entry.tag), '共享弹层组件里没看到这些弹层，规则可能过期了').toHaveLength(
      OVERLAYS.length,
    )
  })

  it('页面不再自己装配这些弹层', () => {
    const offenders = mountedOutside()
    expect(
      offenders,
      [
        `这些地方直接挂了仓库弹层：${offenders.length} 处`,
        ...offenders,
        '同一个弹层在几个页面各接一遍线，接法迟早会走偏。',
        '页面用 <RepoOverlays />，上下文差异通过 props 传进去。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享组件自己读 layer，而不是从外面收开关', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)!.text
    const props = owner.match(/interface RepoOverlaysProps \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(props, '找不到 RepoOverlaysProps').toContain('repoId')
    expect(props, 'props 里不该再有开关，开关由 layer 决定').not.toMatch(
      /^\s*(open|onOpenChange|isOpen|onClose)\??:/m,
    )
    const layers = [...owner.matchAll(/useLayer\('([^']+)'\)/g)].map((match) => match[1])
    expect(layers, '共享组件没有自己读 layer，开关就没人接了').toEqual(
      expect.arrayContaining(['files', 'lsp', 'skills', 'mcp', 'sourceControl', 'resetPermissions']),
    )
  })
})
