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
// the source-control feature. Loading already had a component, but the rule
// guarding it was written against the paddings it had seen so far.
const HAND_ROLLED_MESSAGE = /<div className="text-center py-12 text-muted-foreground">/
// A centred box whose first child is a spinner.
const HAND_ROLLED_SPINNER =
  /<div className="[^"]*\bitems-center\b[^"]*\bjustify-center\b[^"]*"[^>]*>\s*<Loader2/

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

  it('没有人再自己画"面板正在加载"的那一个转圈', () => {
    // A centred box whose first child is a spinner is a panel saying "still
    // working". The padding on that box is a free choice, which is exactly
    // why an earlier version of this rule, written against the two paddings
    // it had already seen, let fifteen of them through.
    const offenders = SOURCES.filter(
      (source) => source.rel !== LOADING_OWNER && HAND_ROLLED_SPINNER.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己画了居中的加载转圈：${offenders.length} 处`,
        ...offenders,
        '用 <PanelLoading />，外层间距用 className 传。',
      ].join('\n'),
    ).toEqual([])
  })

  it('类名里没有拼不出来的东西', () => {
    // A regex that strips one class can quietly eat another: removing "flex"
    // with \bflex\b also takes the "flex" out of "flex-1" and leaves "-1",
    // which is not a Tailwind class. Nothing renders, nothing errors.
    const bogus = /(?:^|[\s"])-[\d]+(?:[\s"]|$)/
    const offenders = SOURCES.filter((source) =>
      source.text.split('\n').some((line) => bogus.test(line) && line.includes('className')),
    ).map((source) => source.rel)
    expect(
      offenders,
      `这些文件的 className 里有拼不出来的片段：${offenders.join(', ')}`,
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
