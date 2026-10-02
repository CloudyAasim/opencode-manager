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

/**
 * "Nothing here" and "that did not work" were both drawn out by hand in every
 * tab of the source-control feature - same centred block, same dimmed icon, same
 * title, same smaller detail line. Seven copies, and SettingsList had already
 * grown its own version of the same thing.
 *
 * This rule used to look for `py-12`, which is only the padding PanelMessage
 * happens to use. Every other centred muted block in the tree was on some other
 * padding, so the rule matched the owner and nothing else: it had never fired,
 * and the two real copies (SettingsList's error block, RepoMcpServerList's empty
 * block) were sitting right there waiting. Padding is a free choice, so the
 * shape is what the rule keys on - a centred muted box that holds a sized icon
 * and a small title.
 */
const CENTRED_MUTED_BOX = /<div className="[^"]*\btext-center\b[^"]*\btext-muted-foreground\b[^"]*"/g
const SIZED_ICON = /<[A-Z][A-Za-z0-9]*(?=[^>]*\bclassName="[^"]*\b(?:w-|h-)[0-9])[^>]*\s*\/>/
const SMALL_TITLE = /<p className="text-sm"/

function handRolledMessages(text: string): number {
  let count = 0
  for (const m of text.matchAll(CENTRED_MUTED_BOX)) {
    const body = text.slice(m.index + m[0].length, m.index + m[0].length + 700)
    if (SIZED_ICON.test(body) && SMALL_TITLE.test(body)) count += 1
  }
  return count
}

// A centred box whose first child is a spinner.
const HAND_ROLLED_SPINNER =
  /<div className="[^"]*\bitems-center\b[^"]*\bjustify-center\b[^"]*"[^>]*>\s*<Loader2/

describe('面板的三态各只有一个组件', () => {
  it('门禁看得见两个组件', () => {
    expect(SOURCES.some((source) => source.rel === MESSAGE_OWNER), '找不到 PanelMessage').toBe(true)
    expect(SOURCES.some((source) => source.rel === LOADING_OWNER), '找不到 PanelLoading').toBe(true)
  })

  it('量法自己还认得出一块手抄的提示块', () => {
    // A rule that silently matches nothing is worse than no rule: it looks like
    // protection. So the detector is checked against a hand-rolled copy written
    // out here, on a padding this rule deliberately does not mention.
    const sample = `
      <div className="text-center py-6 text-muted-foreground">
        <Plug className="w-10 h-10 mx-auto mb-3 opacity-50" />
        <p className="text-sm">{t('repo.mcp.noServers')}</p>
        <p className="text-xs mt-1">{t('repo.mcp.noServersHint')}</p>
      </div>`
    expect(handRolledMessages(sample)).toBe(1)
  })

  it('没有人再自己画"空 / 出错"那一块', () => {
    const offenders = SOURCES
      .filter((source) => source.rel !== MESSAGE_OWNER && handRolledMessages(source.text) > 0)
      .map((source) => source.rel)
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
    const offenders = SOURCES.filter((source) =>
      /mx-auto/.test(source.text) && /mb-2/.test(source.text) && /opacity-50/.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      `这些地方还在自己给图标定位置和透明度：${offenders.join(', ')}`,
    ).toEqual([MESSAGE_OWNER])
  })
})
