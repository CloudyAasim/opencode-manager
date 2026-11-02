import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments, tagAt } from './source-text'
import { en } from '@/lib/i18n/locales/en'

/**
 * "Let the layout speak for itself", in the parts a machine can check.
 *
 * KDE's Human principle says to remove or minimise the elements that are not
 * essential, so that the user can look at what is important. A second line of
 * text under a heading that says what the heading already said is exactly
 * such an element: it takes up a line, it takes the eye, and it says nothing
 * the layout did not already say.
 *
 * So there is one rule here: **a thing is named once.**
 *
 * It shows up in two shapes, and both of them are mechanical:
 *
 * - The same key is used as a heading and as a button. The card says "Change
 *   Password" and the button inside it says "Change Password", so the phrase
 *   is written down twice and can be changed in two places.
 * - A description says the heading it sits under. "Passkeys" with the line
 *   "Manage passkeys for passwordless sign-in" under it says "passkeys" twice
 *   within two lines of each other.
 *
 * What the gate does **not** judge is whether a description is *useful*. A
 * description that says what will happen, or what the user has to watch out
 * for, is doing its job - the wording has to be a judgement, and a judgement
 * cannot be a gate. What the gate can see is the same words twice, and the
 * few descriptions that have to keep saying the title anyway are named one
 * by one below.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')
const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])
const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

/**
 * The descriptions that have to keep saying the title, one by one.
 *
 * Each entry is one pair and one reason. A list that grows on its own is a
 * list nobody reads, so the gate below also checks that this list is exactly
 * the set of descriptions that are kept - no stale entries, no new ones.
 */
const KEPT_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  [
    'ui.discardDialog.title / ui.discardDialog.description',
    '这是危险确认，必须说清要丢掉什么',
  ],
  [
    'settingsPanels.provider.removeCredentialsTitle / settingsPanels.provider.removeCredentialsDescription',
    '这是危险确认，必须说清要动谁的凭据',
  ],
])

function englishOf(key: string): string | null {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en as unknown,
    )
  return typeof value === 'string' ? value : null
}

/** The keys a piece of JSX reads. */
function keysBetween(text: string, open: number, close: number): string[] {
  const keys: string[] = []
  for (const match of text.slice(open, close).matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) {
    keys.push(match[1]!)
  }
  return keys
}

/** Every `<Tag>…</Tag>` in the text, with the keys inside it and its own tag. */
function elements(
  text: string,
  tag: string,
): Array<{ keys: string[]; open: string; start: number; end: number }> {
  const found: Array<{ keys: string[]; open: string; start: number; end: number }> = []
  const matcher = new RegExp(`<${tag}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const start = match.index
    const close = text.indexOf(`</${tag}>`, start)
    if (close < 0) continue
    found.push({
      keys: keysBetween(text, start, close),
      open: tagAt(text, start),
      start,
      end: close,
    })
    matcher.lastIndex = close
  }
  return found
}

/** A part whose `prop` is given a translation key. */
function propKeys(text: string, part: string, prop: string): string[] {
  const keys: string[] = []
  const matcher = new RegExp(`<${part}\\b`, 'g')
  let match: RegExpExecArray | null
  while ((match = matcher.exec(text)) !== null) {
    const open = tagAt(text, match.index)
    const attribute = new RegExp(`\\b${prop}=\\{\\s*t\\(\\s*'([^']+)'`)
    const hit = attribute.exec(open)
    if (hit) keys.push(hit[1]!)
    matcher.lastIndex = match.index + open.length
  }
  return keys
}

/**
 * The parts that draw a heading, and the props they draw it with. A heading
 * is not "anything with a `title` prop" - `title` is a tooltip on half the
 * parts in this application, and `aria-label` is a name for a control that has
 * no visible text at all. The shape of a heading is a known set of parts.
 */
const HEADING_PARTS: Array<[string, string]> = [
  ['SectionHeader', 'title'],
  ['SettingsListRow', 'title'],
  ['SettingsPanel', 'title'],
  ['PanelMessage', 'title'],
]

/** The parts that draw a heading as their own child. */
const HEADING_CHILDREN = ['CardTitle', 'DialogTitle', 'h1', 'h2', 'h3']

function headingKeys(text: string): string[] {
  const keys: string[] = []
  for (const [part, prop] of HEADING_PARTS) keys.push(...propKeys(text, part, prop))
  for (const tag of HEADING_CHILDREN) {
    for (const element of elements(text, tag)) keys.push(...element.keys)
  }
  // A heading drawn by hand: a paragraph in the weight a heading is in. The
  // weight is the shape - a title is never regular text.
  for (const element of elements(text, 'p')) {
    if (!/font-(medium|semibold)/.test(element.open)) continue
    keys.push(...element.keys)
  }
  return keys
}

function buttonKeys(text: string): string[] {
  const keys: string[] = []
  for (const element of elements(text, 'Button')) keys.push(...element.keys)
  for (const pattern of [
    /\bconfirmLabel=\{\s*t\(\s*'([^']+)'\s*\)/g,
    /\bprimaryAction=\{\{\s*label:\s*t\(\s*'([^']+)'\s*\)/g,
    /\bactions=\{\[\s*\{\s*label:\s*t\(\s*'([^']+)'\s*\)/g,
  ]) {
    let match: RegExpArray | null
    while ((match = pattern.exec(text)) !== null) keys.push(match[1]!)
  }
  return keys
}

interface DescriptionPair {
  titleKey: string
  descriptionKey: string
  where: string
}

/**
 * The parts that take a heading and a description of their own, so that the
 * two are read as one pair.
 */
const TITLE_WITH_DESCRIPTION_PARTS = [
  'SectionHeader',
  'SettingsPanel',
  'SettingsListRow',
  'ConfirmDestructiveDialog',
  'DeleteDialog',
  'DialogTitleBar',
]

function sourcePairs(text: string, where: string): DescriptionPair[] {
  const pairs: DescriptionPair[] = []

  for (const part of TITLE_WITH_DESCRIPTION_PARTS) {
    const matcher = new RegExp(`<${part}\\b`, 'g')
    let match: RegExpExecArray | null
    while ((match = matcher.exec(text)) !== null) {
      const open = tagAt(text, match.index)
      const title = /\btitle=\{\s*t\(\s*'([^']+)'/.exec(open)
      const description = /\bdescription=\{\s*t\(\s*'([^']+)'/.exec(open)
      if (title && description) {
        pairs.push({ titleKey: title[1]!, descriptionKey: description[1]!, where })
      }
      matcher.lastIndex = match.index + open.length
    }
  }

  // A card's heading and the line under it, one after the other.
  for (const [headingTag, descriptionTag] of [
    ['CardTitle', 'CardDescription'],
    ['DialogTitle', 'DialogDescription'],
  ]) {
    const headings = elements(text, headingTag)
    const descriptions = elements(text, descriptionTag)
    for (const heading of headings) {
      for (const description of descriptions) {
        if (description.start < heading.end) continue
        if (description.start - heading.end > 300) continue
        if (heading.keys.length === 0 || description.keys.length === 0) continue
        pairs.push({
          titleKey: heading.keys[0]!,
          descriptionKey: description.keys[0]!,
          where,
        })
      }
    }
  }

  // A heading drawn by hand and the line under it. The settings menu draws
  // its entries that way: a name, and a line that says what is inside.
  for (const level of ['h1', 'h2', 'h3']) {
    const headings = elements(text, level)
    const lines = elements(text, 'p')
    for (const heading of headings) {
      for (const line of lines) {
        if (line.start < heading.end) continue
        if (line.start - heading.end > 200) continue
        if (heading.keys.length === 0 || line.keys.length === 0) continue
        pairs.push({
          titleKey: heading.keys[0]!,
          descriptionKey: line.keys[0]!,
          where,
        })
      }
    }
  }

  return pairs
}

function allPairs(): DescriptionPair[] {
  const pairs: DescriptionPair[] = []
  for (const source of SOURCES) pairs.push(...sourcePairs(source.text, source.rel))
  return pairs
}

describe('一个说法只说一次', () => {
  it('门禁看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    const pairs = allPairs()
    expect(pairs.length, '没找到任何一对"标题 + 说明"，这条门禁正在空跑').toBeGreaterThan(3)
    const readable = pairs.filter(
      (pair) => englishOf(pair.titleKey) !== null && englishOf(pair.descriptionKey) !== null,
    )
    expect(readable.length, '找到的对子里没有能查到英文的，这条门禁正在空跑').toBeGreaterThan(3)
  })

  it('同一个键不许同时是标题和按钮', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      const headings = new Set(headingKeys(source.text))
      if (headings.size === 0) continue
      for (const key of buttonKeys(source.text)) {
        if (headings.has(key)) offenders.push(`${source.rel}  ${key}`)
      }
    }

    expect(
      offenders,
      [
        `这些键身兼两职，既是标题又是按钮：${offenders.length} 处`,
        ...offenders,
        '同一个说法写了两遍，就有两个地方能改它。',
        '标题说这是什么，按钮说做什么，两边不用是同一句话。',
      ].join('\n'),
    ).toEqual([])
  })

  it('说明不许把标题又说一遍', () => {
    const offenders: string[] = []
    for (const pair of allPairs()) {
      const title = englishOf(pair.titleKey)
      const description = englishOf(pair.descriptionKey)
      if (!title || !description) continue
      const titleText = title.trim().toLowerCase()
      const descriptionText = description.trim().toLowerCase()
      if (!titleText) continue
      if (!descriptionText.includes(titleText) && !titleText.includes(descriptionText)) continue
      offenders.push(
        `${pair.titleKey} / ${pair.descriptionKey}  "${title}" / "${description}"  (${pair.where})`,
      )
    }

    const kept = offenders.filter((entry) =>
      KEPT_DESCRIPTIONS.has(entry.split('  "')[0]!.trim()),
    )
    const unexpected = offenders.filter((entry) => !kept.includes(entry))

    expect(
      unexpected,
      [
        `这些说明把标题又说了一遍：${unexpected.length} 处`,
        ...unexpected,
        '标题已经说过的话，说明里不用再说。',
        '说明该说的是布局说不了的事：会怎样、要小心什么。',
      ].join('\n'),
    ).toEqual([])

    const declared = [...KEPT_DESCRIPTIONS.keys()].sort()
    const actual = kept.map((entry) => entry.split('  "')[0]!.trim()).sort()
    expect(
      declared,
      [
        '点名留下的说明和实际留下的对不上：',
        `名单：${declared.join(' / ') || '（空）'}`,
        `实际：${actual.join(' / ') || '（空）'}`,
        '名单里不该有过期的，实际留下的也不该没被点名。',
      ].join('\n'),
    ).toEqual(actual)
  })
})
