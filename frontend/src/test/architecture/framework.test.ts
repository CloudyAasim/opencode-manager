import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { isProjectPath } from '@/lib/navigation'

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

  it('右侧检视器跟着项目走，不在全局挂', () => {
    // 面板里那三个标签分别是文件、源代码管理、终端，三样都要有项目。
    // 项目外挂着它，按钮在、快捷键在，打开却是一个空壳。
    //
    // 数出现次数：每一处只许出现一次，而且那一次必须在那个先问过
    // isProjectPath 的组件里。用"把组件挖掉再看剩下的"那种写法会
    // 依赖对边界的猜测，猜错就等于没有规则。
    const app = SOURCES.find((source) => source.rel === 'App.tsx')!.text
    const start = app.indexOf('function ProjectInspector')
    expect(start, 'App.tsx 里应当有一个按项目判断的检视器组件').toBeGreaterThan(-1)

    let depth = 0
    let end = -1
    for (let i = app.indexOf('{', start); i < app.length; i++) {
      if (app[i] === '{') depth++
      else if (app[i] === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    const inside = app.slice(start, end)
    const outside = app.slice(0, start) + app.slice(end)

    for (const name of ['FileBrowserInspectorTab', 'SourceControlInspectorTab', 'TerminalInspectorTab', 'InspectorCommands']) {
      const total = app.split(`<${name}`).length - 1
      const scoped = inside.split(`<${name}`).length - 1
      expect(total, `${name} 在 App.tsx 里出现了 ${total} 次`).toBe(1)
      expect(scoped, `${name} 必须挂在按项目判断的那个组件里`).toBe(1)
      expect(outside, `App.tsx 根部直接挂了 ${name}，检视器于是又变成全局的`).not.toContain(`<${name}`)
    }

    expect(app, '检视器应当经过那个按项目判断的组件').toContain('<ProjectInspector />')
    expect(app, 'App.tsx 要判断项目范围就得用同一个判断').toContain('isProjectPath')
  })

  it('哪些页面算"在项目里"', () => {
    // 助手是 repo 0，它那三个标签要读的也是同一个项目。
    for (const inside of ['/repos/3', '/repos/3/sessions/s1', '/repos/0/assistant', '/assistant']) {
      expect(isProjectPath(inside), `${inside} 应当算在项目里`).toBe(true)
    }
    for (const outside of ['/', '/files', '/schedules', '/settings', '/terminal', '/login', '/setup']) {
      expect(isProjectPath(outside), `${outside} 不该挂检视器`).toBe(false)
    }
  })
})
