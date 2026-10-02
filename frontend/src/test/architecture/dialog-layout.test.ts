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

const OWNER = 'components/ui/dialog-layout.tsx'

// Six settings dialogs lay their inside out the same way: a title bar with a
// bottom border, then a body that fills the rest and scrolls. The three
// orderings of the same classes are what typing it six times looks like.
//
// Matched on the whole class string, not a prefix: two other dialogs in the
// codebase start with "p-4 sm:p-6 border-b" and then do something else.
const HAND_ROLLED_HEADER = 'className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0"'
const HAND_ROLLED_BODY = 'className="flex-1 overflow-y-auto p-2 sm:p-4"'

const DIALOGS = [
  'features/settings/AgentDialog.tsx',
  'features/settings/SkillDialog.tsx',
  'features/settings/SkillInstallDialog.tsx',
  'features/settings/AddMcpServerDialog.tsx',
  'features/settings/CommandDialog.tsx',
  'features/settings/OpenCodeModelDialog.tsx',
]

describe('对话框内部只有一种排法', () => {
  it('门禁看得见这六个对话框', () => {
    expect(SOURCES.some((source) => source.rel === OWNER), `找不到 ${OWNER}`).toBe(true)
    const missing = DIALOGS.filter(
      (rel) => !SOURCES.some((source) => source.rel === rel && source.text.includes('<DialogLayout')),
    )
    expect(missing, `这些对话框还没用共享排法：${missing.join(', ')}`).toEqual([])
  })

  it('没有人再自己写那条标题栏', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== OWNER && source.text.includes(HAND_ROLLED_HEADER),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己写了对话框标题栏：${offenders.length} 处`,
        ...offenders,
        '用 <DialogLayout />。',
      ].join('\n'),
    ).toEqual([])
  })

  it('主体只有一种写法，类名不再换顺序', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== OWNER && source.text.includes(HAND_ROLLED_BODY),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己写了对话框的可滚动主体：${offenders.length} 处`,
        ...offenders,
        '同一组类名已经出现过三种顺序，这正是它该由组件统一的原因。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享组件自己带着那套类名', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)!.text
    expect(owner).toContain(HAND_ROLLED_HEADER)
    expect(owner).toContain(HAND_ROLLED_BODY)
  })
})
