import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const OWNER = 'components/ui/dialog-layout.tsx'

// Six settings dialogs lay their inside out the same way: a title bar with a
// bottom border, then a body that fills the rest and scrolls. The three
// orderings of the same classes are what typing it six times looks like.
//
// This rule used to match one exact class string, so it could only ever see
// the six dialogs it was written for. Six more dialogs had their own title
// bar, in six more spellings of the same box, and the rule never noticed
// them. A title bar is recognised by its shape now: a header that has a
// border under it.
// A title bar is recognised by its shape: a header that has a border under
// it. The window is taken from the tag rather than parsed out of it, so it
// does not matter whether the classes arrive as a string or through cn().
const TITLE_BAR = /<DialogHeader\b/g

const DIALOGS = [
  'features/settings/AgentDialog.tsx',
  'features/settings/SkillDialog.tsx',
  'features/settings/SkillInstallDialog.tsx',
  'features/settings/AddMcpServerDialog.tsx',
  'features/settings/CommandDialog.tsx',
  'features/settings/OpenCodeModelDialog.tsx',
]

function handRolledTitleBars(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(TITLE_BAR)) {
    const window = text.slice(match.index, match.index + 300)
    if (!/\bborder-b\b/.test(window)) continue
    const classes = /\bclassName=(?:"([^"]*)"|\{([^}]*)\})/.exec(window)
    found.push((classes?.[1] ?? classes?.[2] ?? '').replace(/\s+/g, ' ').trim())
  }
  return found
}

describe('对话框内部只有一种排法', () => {
  it('门禁看得见这六个对话框', () => {
    expect(SOURCES.some((source) => source.rel === OWNER), `找不到 ${OWNER}`).toBe(true)
    const missing = DIALOGS.filter(
      (rel) => !SOURCES.some((source) => source.rel === rel && source.text.includes('<DialogLayout')),
    )
    expect(missing, `这些对话框还没用共享排法：${missing.join(', ')}`).toEqual([])
  })

  it('没有人再自己写那条标题栏', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (source.rel === OWNER) continue
      for (const classes of handRolledTitleBars(source.text)) {
        offenders.push(`${source.rel}  ${classes}`)
      }
    }
    expect(
      offenders,
      [
        `这些文件自己写了对话框标题栏：${offenders.length} 处`,
        ...offenders,
        '用 <DialogTitleBar />，或者整个对话框用 <DialogLayout />。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享组件自己带着那套类名', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)!
    const bars = handRolledTitleBars(owner.text)
    expect(bars.length, '共享组件自己没有那条标题栏').toBe(1)
    expect(bars[0]).toContain('border-b')
    expect(bars[0]).toContain('p-4 sm:p-6')
    expect(owner.text, '共享组件没有那条可滚动主体').toContain('flex-1 overflow-y-auto')
  })

  it('那条标题栏在仓库里只有一处', () => {
    // The class string of the title bar exists in exactly one file: the
    // component that draws it. Two copies is how a dialog ends up with a
    // title bar that is one pixel off the one next to it.
    const owners = SOURCES.filter((source) => handRolledTitleBars(source.text).length > 0).map(
      (source) => source.rel,
    )
    expect(owners).toEqual([OWNER])
  })
})
