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

// A page that wants a feature to do something reaches for a data attribute and
// clicks it. That is a dependency drawn in the wrong direction, and it breaks
// silently when the feature renames the attribute.
//
// The rule is scoped to pages on purpose. A page is the composition boundary,
// so this is where a sideways reach shows up. Two other shapes are legitimate
// and deliberately not covered: hooks/ asking a global question about focus
// (which marker has the caret), and a primitive like combobox querying the
// options it rendered itself.
const DOM_REACH = /querySelector(?:All)?\([^)]*\[data-[a-z-]+/g

// The actions that live inside a feature: the behaviour, the trigger and the
// name of the shortcut all belong to the same directory.
const FEATURE_OWNED: ReadonlyArray<{ action: string; owner: string }> = [
  { action: 'submit', owner: 'features/message/' },
  { action: 'selectModel', owner: 'features/message/' },
  { action: 'toggleMode', owner: 'features/message/' },
  { action: 'variantCycle', owner: 'features/message/' },
]

describe('页面不通过 DOM 伸手进 feature', () => {
  it('门禁看得见它要守的东西', () => {
    expect(SOURCES.length, '源码没扫到').toBeGreaterThan(200)
    const registered = FEATURE_OWNED.map(({ action, owner }) => ({
      action,
      found: SOURCES.some(
        (source) =>
          source.rel.startsWith(owner) &&
          new RegExp(`useShortcutAction\\('${action}'`).test(source.text),
      ),
    }))
    expect(
      registered.filter((entry) => !entry.found).map((entry) => entry.action),
      '这些 feature 动作没人注册，规则本身可能已经过期',
    ).toEqual([])
  })

  it('页面不用 querySelector 找 feature 的 data-* 元素', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel.startsWith('pages/') && DOM_REACH.test(source.text),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些页面用 querySelector 找 data-* 属性：${offenders.length} 处`,
        ...offenders,
        'feature 的行为由 feature 自己接：useShortcutAction，或者 useImperativeHandle。',
        '靠属性名跨目录连线，改一次属性名就是一次静默失效。',
      ].join('\n'),
    ).toEqual([])
  })

  it('页面不再为 feature 拥有的动作提供实现', () => {
    const page = SOURCES.find((source) => source.rel === 'pages/SessionDetail.tsx')!.text
    const actionMap = page.match(/useKeyboardShortcuts\(\{[\s\S]*?\n {2}\}\)/)?.[0] ?? ''
    for (const { action, owner } of FEATURE_OWNED) {
      if (!owner.startsWith('features/')) continue
      expect(actionMap, `页面不该再实现 ${action}`).not.toContain(`${action}:`)
    }
  })
})
