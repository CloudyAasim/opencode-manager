import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_DIRECT_SHORTCUTS, DEFAULT_KEYBOARD_SHORTCUTS } from '@opencode-manager/shared'
import { ALL_KEYBOARD_ACTIONS } from '@/framework/commands/keyboardActions'
import { parseEventShortcut } from '@/framework/commands/shortcutMatch'
import { buildImportGraph, relativeTo } from './import-graph'

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const SHARED_SRC = path.resolve(FRONTEND_SRC, '../../shared/src')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const FRONTEND_SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

function readDir(dir: string, base = dir): Array<{ rel: string; text: string }> {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') return []
      return readDir(full, base)
    }
    if (!/\.tsx?$/.test(entry.name)) return []
    return [{ rel: path.relative(base, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') }]
  })
}

const REPO_SOURCES = [...FRONTEND_SOURCES, ...readDir(SHARED_SRC)]

const FEATURE_ACTION = /useShortcutAction\(\s*'([^']+)'/g

// Names a KeyboardEvent carries that parseEventShortcut always rewrites.
const UNREACHABLE_MAIN_KEYS = new Set([
  ' ',
  'Enter',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

function pageActionKeys(): Set<string> {
  const keys = new Set<string>()
  for (const source of FRONTEND_SOURCES) {
    let from = 0
    for (;;) {
      const start = source.text.indexOf('useKeyboardShortcuts({', from)
      if (start === -1) break
      from = start + 1
      const end = source.text.indexOf('\n  })', start)
      const body = source.text.slice(start, end === -1 ? undefined : end)
      for (const match of body.matchAll(/^ {4}(\w+):/gm)) keys.add(match[1]!)
    }
  }
  return keys
}

function featureActionNames(): Set<string> {
  const names = new Set<string>()
  for (const source of FRONTEND_SOURCES) {
    for (const match of source.text.matchAll(FEATURE_ACTION)) names.add(match[1]!)
  }
  return names
}

const VOCABULARY = ['CONVERSATION_ACTIONS', 'NAVIGATION_ACTIONS', 'ALL_KEYBOARD_ACTIONS', 'DEFAULT_DIRECT_SHORTCUTS', 'DEFAULT_KEYBOARD_SHORTCUTS'] as const
const DECLARATION = new RegExp(`(?:export\\s+)?const\\s+(${VOCABULARY.join('|')})\\b`, 'g')

function declarationSites(): Map<string, string[]> {
  const sites = new Map<string, string[]>()
  for (const source of REPO_SOURCES) {
    for (const match of source.text.matchAll(DECLARATION)) {
      const name = match[1]!
      const list = sites.get(name) ?? []
      list.push(source.rel)
      sites.set(name, list)
    }
  }
  return sites
}

describe('快捷键动作表', () => {
  it('门禁真的找到了动作表和它的两个消费方', () => {
    expect(ALL_KEYBOARD_ACTIONS.length, '动作表是空的，下面每条门禁都在空转').toBeGreaterThan(10)
    expect(pageActionKeys().size, '没抓到页面的动作表，说明改写规则过期了').toBeGreaterThan(5)
    expect(featureActionNames().size, '没抓到 feature 侧注册的动作').toBeGreaterThan(0)
  })

  it('默认快捷键里的每个动作都在动作表里', () => {
    const missing = Object.keys(DEFAULT_KEYBOARD_SHORTCUTS).filter(
      (action) => !ALL_KEYBOARD_ACTIONS.includes(action),
    )
    expect(
      missing,
      [
        `这些动作有默认键，但设置面板不会列出它们：${missing.length} 处`,
        ...missing,
        '新加一个默认键时，要同时把它加进 ALL_KEYBOARD_ACTIONS。',
      ].join('\n'),
    ).toEqual([])
  })

  it('动作表里的每个动作都真的会被执行', () => {
    const dispatched = new Set<string>([...pageActionKeys(), ...featureActionNames()])
    const orphans = ALL_KEYBOARD_ACTIONS.filter((action) => !dispatched.has(action))
    expect(
      orphans,
      [
        `这些动作面板里能改键，运行时却没有任何地方执行：${orphans.length} 处`,
        ...orphans,
        '要么在页面的 useKeyboardShortcuts 里给出实现，',
        '要么在拥有它的 feature 里 useShortcutAction 注册。',
      ].join('\n'),
    ).toEqual([])
  })

  it('默认直触的动作都真实存在', () => {
    const unknown = DEFAULT_DIRECT_SHORTCUTS.filter((action) => !ALL_KEYBOARD_ACTIONS.includes(action))
    expect(unknown, `DEFAULT_DIRECT_SHORTCUTS 里有不存在的动作：${unknown.join(', ')}`).toEqual([])
  })

  it('默认键的主键都是解析器真能产出的名字', () => {
    // The premise: pressing Enter never produces a chord spelled "Enter".
    expect(parseEventShortcut(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))).toBe(
      'Ctrl+Return',
    )

    const unreachable = Object.entries(DEFAULT_KEYBOARD_SHORTCUTS)
      .map(([action, binding]) => [action, binding.split('+').pop() ?? ''] as const)
      .filter(([, mainKey]) => UNREACHABLE_MAIN_KEYS.has(mainKey))
    expect(
      unreachable.map(([action, mainKey]) => `${action}: ${mainKey}`),
      [
        `这些默认键的主键名解析器永远不会产出，所以它们一次都匹配不上：${unreachable.length} 处`,
        ...unreachable.map(([action, mainKey]) => `${action} -> ${mainKey}`),
        '写默认键时要用解析器认的名字（Enter 写作 Return，Escape 写作 Esc，空格写作 Space）。',
      ].join('\n'),
    ).toEqual([])
  })

  it('动作表和默认直触表各只声明一次', () => {
    const sites = declarationSites()
    const duplicated = VOCABULARY.flatMap((name) => {
      const found = sites.get(name) ?? []
      return found.length === 1 ? [] : [`${name} 声明了 ${found.length} 次：${found.join(', ')}`]
    })
    expect(
      duplicated,
      [
        `下面这些常量存在多份定义：${duplicated.length} 处`,
        ...duplicated,
        '第二份副本迟早会和第一份走偏——variantCycle 就是这么变成一个改了键却没反应的设置的。',
        '注意不导出也算：面板里当年那份就是本地 const。',
      ].join('\n'),
    ).toEqual([])
  })

  it('默认键归 shared 管，动作表归框架管', () => {
    const sites = declarationSites()
    expect(sites.get('DEFAULT_KEYBOARD_SHORTCUTS'), '默认键应该由 shared 声明').toEqual(['schemas/settings.ts'])
    expect(sites.get('DEFAULT_DIRECT_SHORTCUTS'), '默认直触表应该由 shared 声明').toEqual(['schemas/settings.ts'])
    expect(sites.get('ALL_KEYBOARD_ACTIONS'), '动作表应该由框架声明').toEqual([
      'framework/commands/keyboardActions.ts',
    ])
  })
})
