import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * 对话框的标题栏只有一种写法。
 *
 * 七个对话框曾经各画各的标题栏，一共六种写法（`p-4 sm:p-6 border-b`、
 * `border-b border-border px-4 py-4`、`shrink-0 space-y-1 border-b border-border
 * px-3 sm:px-6 py-4`……）。后来它们都用 `DialogTitleBar` 了。
 *
 * 这条门禁守的是同一件事：**标题栏的样子由共享的组件画**，而不是每个弹窗
 * 自己写一份。认的是**形状**——一个自己带着分隔线或内边距的 `<DialogHeader>`
 * 就是手写的标题栏。
 *
 * 门禁自己也不写死某一串类名：共享的那副顶栏是什么样子，是门禁从组件里
 * 读出来的。
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const OWNER = 'components/ui/dialog-layout.tsx'

/** 共享的弹窗零件：顶栏的形状是它们画的。 */
const SHARED_PARTS = ['components/ui/dialog.tsx', OWNER]

const DIALOGS = [
  'features/settings/AgentDialog.tsx',
  'features/settings/SkillDialog.tsx',
  'features/settings/SkillInstallDialog.tsx',
  'features/settings/AddMcpServerDialog.tsx',
  'features/settings/CommandDialog.tsx',
  'features/settings/OpenCodeModelDialog.tsx',
]

/**
 * 手写的标题栏。
 *
 * 一个 `<DialogHeader>` 如果**自己**带着分隔线，它就不是共享的那副顶栏了。
 * 类名是这个标签自己的——不是它后面那个元素的（那会把一屏里的身子当成
 * 顶栏）。
 */
const TITLE_BAR = /<DialogHeader\b([^>]*)>/g

/** 内边距的工具类。 */
const PADDING = /\b(?:[a-z]+:)*p[trblxy]?-[\d.]+/

function handRolledTitleBars(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(TITLE_BAR)) {
    const attrs = match[1] ?? ''
    const literal = /className="([^"]*)"/.exec(attrs)?.[1]
    const expression = /className=\{([^}]*)\}/.exec(attrs)?.[1]
    const classes = (literal ?? expression ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!/\bborder-b\b/.test(classes)) continue
    found.push(classes)
  }
  return found
}

/** 共享的 `DialogTitleBar` 自己那一串类名。 */
function titleBarClasses(): string {
  const owner = SOURCES.find((source) => source.rel === OWNER)
  if (!owner) return ''
  const declaration = owner.text.indexOf('export function DialogTitleBar')
  if (declaration === -1) return ''
  const window = owner.text.slice(declaration, declaration + 1200)
  const single = /cn\(\s*'([^']*)'/.exec(window)?.[1]
  const double = /cn\(\s*"([^"]*)"/.exec(window)?.[1]
  return (single ?? double ?? '').replace(/\s+/g, ' ').trim()
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
    // 这一条现在由 `dialog-title.test.ts` 管：顶栏的形状（字号、对齐、
    // 分隔线、内边距）由共享的零件画，调用点不自己写，而且"自己管版式"
    // 的那几个弹窗在那边有一份带理由的例外名单。
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (SHARED_PARTS.includes(source.rel)) continue
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
  it('共享的顶栏不自己带内边距，也不自己画线', () => {
    // 内边距由框带（共享的那一副），分隔线由共享的顶栏画——
    // 两样各在一个地方说了算，弹窗自己带就多了一副画法。
    const owner = SOURCES.find((source) => source.rel === OWNER)!
    const classes = titleBarClasses()
    expect(classes, '认不出共享的顶栏').not.toBe('')
    expect(classes, '共享的顶栏自己带了内边距').not.toMatch(PADDING)
    expect(classes, '共享的顶栏自己画了分隔线').not.toMatch(/\bborder-b\b/)
    expect(owner.text, '共享组件没有那条可滚动主体').toContain('flex-1 overflow-y-auto')
  })

  it('那条标题栏在仓库里只有一处', () => {
    // The class string of the title bar exists in exactly one file: the
    // component that draws it. Two copies is how a dialog ends up with a
    // title bar that is one pixel off the one next to it.
    const classes = titleBarClasses()
    expect(classes, '认不出共享的顶栏').not.toBe('')
    const owners = SOURCES.filter((source) => source.text.includes(classes)).map(
      (source) => source.rel,
    )
    expect(owners).toEqual([OWNER])
  })
})
