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

const OWNER = 'framework/shell/AuthShell.tsx'

// The three auth pages already share AuthShell, AuthCard, AuthError, AuthField
// and AuthSubmit. The input was the odd one out: every field on every page
// restated the same three classes, which is exactly how three pages end up
// looking slightly different from one another.
const AUTH_INPUT_CLASS = 'bg-input border-border focus:border-primary'
const AUTH_PAGES = ['pages/Login.tsx', 'pages/Register.tsx', 'pages/Setup.tsx']

describe('认证输入框的样式只写一次', () => {
  it('门禁看得见它要守的那三个页面', () => {
    for (const page of AUTH_PAGES) {
      const source = SOURCES.find((entry) => entry.rel === page)
      expect(source, `找不到 ${page}`).toBeDefined()
      expect(source!.text, `${page} 还在手写输入框样式`).toContain('<AuthInput')
    }
  })

  it('只有共享组件里有这段样式', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== OWNER && source.text.includes(AUTH_INPUT_CLASS),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件又写了一遍认证输入框的样式：${offenders.length} 处`,
        ...offenders,
        '用 <AuthInput />。三个页面写三遍，改配色就要改三遍。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享组件真的带上了这段样式', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)!.text
    expect(owner, '共享组件里找不到这段样式').toContain(AUTH_INPUT_CLASS)
    expect(owner, 'AuthInput 没有透传调用方自己的 className').toMatch(
      /export function AuthInput\(\{ className, \.\.\.props \}/,
    )
  })
})
