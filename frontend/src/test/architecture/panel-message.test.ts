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

const MESSAGE_OWNER = 'components/ui/panel-message.tsx'
const LOADING_OWNER = 'components/ui/panel-loading.tsx'

// "Nothing here" and "that did not work" were drawn out by hand in every tab of
// the source-control feature. Loading had already been given a component in the
// previous round, but a second padding variant was still being hand-written.
const HAND_ROLLED_MESSAGE = /<div className="text-center py-12 text-muted-foreground">/
const HAND_ROLLED_LOADING =
  /<div className="flex items-center justify-center py-(?:8|12)">\s*\n\s*<Loader2/

describe('面板的三态各只有一个组件', () => {
  it('门禁看得见两个组件', () => {
    expect(SOURCES.some((source) => source.rel === MESSAGE_OWNER), '找不到 PanelMessage').toBe(true)
    expect(SOURCES.some((source) => source.rel === LOADING_OWNER), '找不到 PanelLoading').toBe(true)
  })

  it('没有人再自己画"空 / 出错"那一块', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== MESSAGE_OWNER && HAND_ROLLED_MESSAGE.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己画了居中提示块：${offenders.length} 处`,
        ...offenders,
        '用 <PanelMessage />：图标、标题、细节、操作，四件东西的排版只该有一处。',
      ].join('\n'),
    ).toEqual([])
  })

  it('没有人再自己画转圈的加载块', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== LOADING_OWNER && HAND_ROLLED_LOADING.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己画了加载块：${offenders.length} 处`,
        ...offenders,
        '用 <PanelLoading />。上一轮清了 py-12 那一族，py-8 这一族漏了。',
      ].join('\n'),
    ).toEqual([])
  })

  it('图标尺寸改由组件统一施加', () => {
    const offenders = SOURCES.filter(
      (source) => /mx-auto/.test(source.text) && /mb-2/.test(source.text) && /opacity-50/.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      `这些地方还在自己给图标定位置和透明度：${offenders.join(', ')}`,
    ).toEqual([MESSAGE_OWNER])
  })
})
