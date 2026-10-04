import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const fileRel = (file: string) => relativeTo(graph, file)

const EXPORTED = /^export (?:const|function) (\w+)/gm

const SOURCES = graph.files.map((file) => ({
  rel: fileRel(file),
  text: fs.readFileSync(file, 'utf8'),
}))

function referenceCount(name: string): number {
  const pattern = new RegExp(`\\b${name}\\b`, 'g')
  return SOURCES.reduce((total, source) => total + (source.text.match(pattern) ?? []).length, 0)
}

describe('框架自身的整洁度', () => {
  it('门禁本身在看 framework/ 里的导出', () => {
    const exports = SOURCES.flatMap((source) =>
      source.rel.startsWith('framework/')
        ? [...source.text.matchAll(EXPORTED)].map((match) => match[1]!)
        : [],
    )
    expect(
      exports.length,
      `只匹配到 ${exports.length} 个 framework 导出，等于什么都没看`,
    ).toBeGreaterThan(20)
  })

  it('框架不导出没人用的东西', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (!source.rel.startsWith('framework/')) continue
      for (const match of source.text.matchAll(EXPORTED)) {
        const name = match[1]!
        // one occurrence is the declaration itself
        if (referenceCount(name) <= 1) {
          offenders.push(`${source.rel}  ->  ${name}`)
        }
      }
    }
    expect(
      offenders,
      [
        `这些 framework 导出除了声明之外没有任何引用：${offenders.length} 处`,
        ...offenders,
        '框架是整个项目里最该没有死代码的地方。',
        '留着的通常不是"还没用"，而是上一轮改造忘了收尾。',
      ].join('\n'),
    ).toEqual([])
  })

  it('外壳不再挂右侧检视器', () => {
    // 会话页自己带一个右侧面板（文件 / 源代码管理 / 详情 / 终端），外壳又挂了
    // 一个（文件 / 源代码管理 / 终端）—— 终端那两边用的是同一个 TerminalView。
    // 于是会话页出现两个右侧栏，最右那个是外壳的，纯属重复。
    //
    // 这里断言的是"删掉了"，不是"藏起来了"：一个还能被调用方塞内容的空槽位，
    // 早晚会再被填满，然后问题原样回来。
    const offenders: string[] = []
    for (const name of [
      'Inspector',
      'InspectorProvider',
      'FileBrowserInspectorTab',
      'SourceControlInspectorTab',
      'TerminalInspectorTab',
      'InspectorCommands',
    ]) {
      for (const source of SOURCES) {
        if (source.text.includes(name)) {
          offenders.push(`${source.rel} -> ${name}`)
        }
      }
    }

    expect(
      offenders,
      [
        `外壳检视器已经删除，却又出现在 ${offenders.length} 处：`,
        ...offenders,
        '要么真的删干净，要么承认它回来了 —— 别停在"先留着"。',
      ].join('\n'),
    ).toEqual([])

    const shellFrame = SOURCES.find((source) => source.rel === 'framework/shell/ShellFrame.tsx')!.text
    expect(shellFrame, 'ShellFrame 不该再留着 inspector 插槽').not.toContain('inspector')
    expect(shellFrame, 'ShellFrame 也不该再 import 检视器').not.toContain('shell/Inspector')
  })

  it('会话页是唯一的右侧面板宿主', () => {
    // 面板留在会话页：它比外壳那个多一个「详情」tab，还带拖拽调宽，
    // 而顶栏本来就有独立的「文件」「终端」页，源代码管理在项目列表的行操作里。
    // 所以删掉外壳那个不丢功能，只是让右边只剩一栏。
    const sessionPanelRefs = SOURCES.filter(
      (source) => source.text.includes('<SessionPanel'),
    ).map((source) => source.rel)

    expect(
      sessionPanelRefs,
      '右侧面板应当只有会话页一个宿主',
    ).toEqual(['pages/SessionDetail.tsx'])
  })
})
