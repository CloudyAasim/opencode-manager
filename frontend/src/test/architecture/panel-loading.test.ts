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

const OWNER = 'components/ui/panel-loading.tsx'

// Ten panels drew their own "still loading" block, and the spinner came out in
// three sizes because each was typed by hand. A fourth hand-rolled one is the
// thing this gate exists to stop.
const HAND_ROLLED = /<div className="flex items-center justify-center py-12">[\s\S]{0,200}?<Loader2/g

describe('加载态只有一个组件', () => {
  it('门禁看得见它要守的那个组件', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)
    expect(owner, `找不到 ${OWNER}`).toBeDefined()
    expect(owner!.text, '组件里没有居中容器，加载态会跑位').toContain(
      'flex items-center justify-center py-12',
    )
    expect(
      SOURCES.filter((source) => source.text.includes('<PanelLoading')).length,
      '一个调用方都没有，规则可能已经过期',
    ).toBeGreaterThan(5)
  })

  it('没有人再自己画这块加载态', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== OWNER && HAND_ROLLED.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己画了加载态：${offenders.length} 处`,
        ...offenders,
        '用 <PanelLoading />。',
        '手搓的代价是尺寸会悄悄漂：现在全项目有三种转圈大小并存。',
      ].join('\n'),
    ).toEqual([])
  })

  it('加载态有可读的名字', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)!.text
    expect(owner, '转圈动画对读屏软件是静默的').toMatch(/role="status"/)
    expect(owner, '缺少 aria-label').toMatch(/aria-label=\{[^}]*ui\.panelLoading\.label/)
  })
})
