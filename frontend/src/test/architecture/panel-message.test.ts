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

/**
 * A state drawn by hand: a block that centres itself, says something in the
 * user's language, and is not a control.
 *
 * The first version of this looked for a balanced element and matched four
 * blocks in the whole repository. The shape it was actually written for - a
 * centred muted div with a sized icon and a small title - was only one of the
 * ways the same idea was drawn by hand: a centred paragraph, a CardContent
 * with an icon in a circle, a dashed box. There were forty-one of those, and
 * every one of them left the user with nothing to press.
 *
 * So the rule now looks for the thing they all have in common: something
 * centred, saying something translatable, that is not a control.
 */
const STATE_TAGS = 'div|p|CardContent|CardHeader|li'
const STATE_OPENING = new RegExp(
  `<(${STATE_TAGS})\\b[^>]*className="([^"]*)"[^>]*>`,
  'g',
)
const INLINE_LABEL = /text-xs|text-\[10px\]|text-\[11px\]|capitalize/
const SAYS_SOMETHING = /t\(\s*['"][a-zA-Z]/

function handRolledStates(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(STATE_OPENING)) {
    const [, tag, classes] = match
    if (tag === 'li') continue
    if (!/\btext-center\b/.test(classes)) continue
    if (INLINE_LABEL.test(classes)) continue
    const body = text.slice(match.index, match.index + 700)
    if (!SAYS_SOMETHING.test(body)) continue
    found.push(`${match.index}:${classes.replace(/\s+/g, ' ').trim().slice(0, 60)}`)
  }
  return found
}

/**
 * The centred blocks that are not states.
 *
 * Each one is here with the reason it is not a state, because a rule that
 * cannot name its exceptions is a rule that has to be switched off.
 */
const NOT_A_STATE: ReadonlyArray<readonly [string, string]> = [
  [
    'components/ui/error-boundary.tsx',
    '整屏的错误边界是一整页，不是一个面板里的状态',
  ],
  [
    'components/ui/route-error-boundary.tsx',
    '整屏的错误边界是一整页，不是一个面板里的状态',
  ],
  [
    'features/file-browser/FileBrowserView.tsx',
    '拖放时的那块提示是拖拽的反馈，随手就消失，不是一个状态',
  ],
  [
    'features/session/SessionList.tsx',
    '那一块空态卡片本身就是按钮（点了就新建会话），还有一行是"正在加载更多"',
  ],
  ['pages/NotFound.tsx', '404 页面上的大号 404 是页面本身，不是一个面板状态'],
  ['pages/Register.tsx', '这是一行说明文字，不是一个状态'],
  ['pages/Setup.tsx', '这是一行说明文字，不是一个状态'],
]

// A centred box whose first child is a spinner.
const HAND_ROLLED_SPINNER =
  /<div className="[^"]*\bitems-center\b[^"]*\bjustify-center\b[^"]*"[^>]*>\s*<Loader2/

/**
 * The props of every `<PanelMessage ... />`, found by matching braces.
 *
 * A regular expression cannot do this: the props contain `icon={<Icon />}`,
 * and the first `/>` in the element is the icon's, not the element's. A
 * scanner that stops there sees a call with no detail and no action, and
 * reports forty-five of them - all of them false.
 */
function panelMessageCalls(text: string): Array<{ props: string; index: number }> {
  const calls: Array<{ props: string; index: number }> = []
  const open = '<PanelMessage'
  let cursor = 0
  for (;;) {
    const start = text.indexOf(open, cursor)
    if (start < 0) break
    let index = start + open.length
    let depth = 0
    let quote: string | null = null
    while (index < text.length) {
      const char = text[index]!
      if (quote) {
        if (char === quote) quote = null
        index += 1
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        index += 1
        continue
      }
      if (char === '{') depth += 1
      if (char === '}') depth -= 1
      if (depth === 0 && char === '/' && text[index + 1] === '>') break
      index += 1
    }
    calls.push({ props: text.slice(start + open.length, index), index: start })
    cursor = index + 2
  }
  return calls
}

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

  it('量法认得出真实的手抄形态', () => {
    // The four shapes the hand-rolled states actually came in, written out
    // here. A detector that only knows the shape it was written against is a
    // detector that has never seen the others.
    const shapes = [
      `<div className="text-center text-muted-foreground py-8">{t('repo.fileBrowser.noFiles')}</div>`,
      `<p className="py-6 text-center text-sm text-destructive">{t('settings.audit.loadFailed')}</p>`,
      `<div className="rounded-lg border border-dashed border-border p-4 text-center"><p>{t('settingsPanels.git.noCredentials')}</p></div>`,
      `<CardContent className="flex flex-col items-center gap-4 p-8 text-center"><p>{t('schedules.global.noRunsFound')}</p></CardContent>`,
    ]
    for (const shape of shapes) {
      expect(handRolledStates(shape).length, `认不出这一种：${shape.slice(0, 50)}`).toBe(1)
    }
    // A label that is merely centred is not a state.
    expect(handRolledStates(`<p className="text-xs text-muted-foreground text-center">{t('x.y')}</p>`).length).toBe(0)
  })

  it('没有人再自己画"空 / 出错"那一块', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (source.rel === MESSAGE_OWNER) continue
      if (NOT_A_STATE.some(([rel]) => rel === source.rel)) continue
      const found = handRolledStates(source.text)
      if (found.length === 0) continue
      offenders.push(`${source.rel}\n    ${found.join('\n    ')}`)
    }
    expect(
      offenders,
      [
        `这些文件自己画了状态块：${offenders.length} 处`,
        ...offenders,
        '用 <PanelMessage />：图标、标题、细节、操作，四件东西的排版只该有一处。',
        '确实不是状态的，写进 NOT_A_STATE 并说明理由。',
      ].join('\n'),
    ).toEqual([])
  })

  it('例外的理由都写清楚了，而且都还在', () => {
    for (const [rel, reason] of NOT_A_STATE) {
      expect(reason.trim().length, `${rel} 没有写为什么它不是状态`).toBeGreaterThan(0)
      const source = SOURCES.find((candidate) => candidate.rel === rel)
      expect(source, `例外里的 ${rel} 已经不存在了`).toBeDefined()
    }
  })

  it('每一个状态都说得出下一步', () => {
    // KDE's Human principle, in a form a machine can check: a state has to
    // answer three questions - what happened, why, and what the user can do
    // about it. A title on its own answers the first and leaves the other two
    // to guesswork.
    const offenders: string[] = []
    for (const source of SOURCES) {
      // The component's own definition is not a call site.
      if (source.rel === MESSAGE_OWNER) continue
      for (const { props, index } of panelMessageCalls(source.text)) {
        if (/\bdetail=/.test(props)) continue
        if (/\baction=/.test(props)) continue
        const line = source.text.slice(0, index).split('\n').length
        offenders.push(`${source.rel}:${line}`)
      }
    }
    expect(
      offenders,
      [
        `这些状态只给了标题，没有说下一步：${offenders.length} 处`,
        ...offenders,
        '要么给一句 detail（为什么/这是什么），要么给一个 action（怎么出去）。',
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

  it('消息图标的尺寸由组件统一施加', () => {
    // The call site hands over an icon; the component decides how big it is.
    // The old version of this rule recognised three class names the component
    // happened to use, so it went red the moment the component was restyled -
    // a rule that breaks when the thing it protects is improved is a rule
    // that gets deleted. This one asks the question directly: does anyone
    // size the icon themselves?
    const offenders: string[] = []
    for (const source of SOURCES) {
      const pattern = /<PanelMessage[\s\S]{0,400}?icon=\{<[A-Za-z]+([^>]*?)\/>/g
      for (const match of source.text.matchAll(pattern)) {
        const classes = match[1] ?? ''
        if (!/\b(?:size|w|h|min-w|min-h)-\d/.test(classes)) continue
        offenders.push(`${source.rel}  ${match[0].replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
    expect(
      offenders,
      [
        `这些地方自己给消息图标定了尺寸：${offenders.length} 处`,
        ...offenders,
        '图标的大小由 PanelMessage 统一施加，调用点只管把图标交进来。',
      ].join('\n'),
    ).toEqual([])

    // And the component really does apply it, so the rule above is not
    // satisfied by a component that sizes nothing.
    const owner = SOURCES.find((source) => source.rel === MESSAGE_OWNER)!
    expect(
      owner.text,
      'PanelMessage 自己没有施加图标尺寸，调用点就必须自己来——那样就等于没有统一',
    ).toMatch(/\[&>svg\]:size-\d/)
  })
})
