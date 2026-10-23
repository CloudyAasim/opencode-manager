import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { twMerge } from 'tailwind-merge'
import { buildImportGraph, relativeTo } from './import-graph'
import { stripComments } from './source-text'

/**
 * One type scale.
 *
 * Typography is the part of an interface everybody reads and nobody agrees
 * on. This repository had four sizes below Tailwind's own scale - 9, 10, 11
 * and 13 pixels - written out as `text-[Npx]` in twenty-nine files. So the
 * same kind of thing was drawn at three different sizes depending on who
 * wrote it: a badge was 10px in one place and 11px in another, and a line of
 * description was 10px on a phone and 12px on a desktop because it was
 * written as `text-[10px] sm:text-xs`.
 *
 * The other half was the rule about text fields: on a phone the browser zooms
 * in on a focused field smaller than 16px and does not zoom back out. That
 * was written out fourteen times as `text-[16px] md:text-sm`, and two of
 * them were wrong.
 *
 * So: one micro step (10px, for the things that are deliberately small), and
 * one named utility for the rule about fields. Everything else is Tailwind's
 * scale, and a number somebody typed is gone.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}))

const CSS = fs.readFileSync(path.join(FRONTEND_SRC, 'index.css'), 'utf8')

/**
 * The stylesheet is not in the import graph - it is not a module anything
 * imports - so the rule that lives in it is read from the file itself.
 */
const CSS_DEFINITIONS = [{ rel: 'index.css', text: CSS }]

const isTest = (rel: string) => rel.includes('.test.')

describe('排版：一条字号刻度', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    expect(
      SOURCES.some((source) => source.rel === 'components/ui/input.tsx'),
      '连输入框都没有，这条门禁读错了地方',
    ).toBe(true)
  })

  it('字号不再有人随手写', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (isTest(source.rel)) continue
      for (const match of source.text.matchAll(/\btext-\[\d+px\]/g)) {
        offenders.push(`${source.rel}: ${match[0]}`)
      }
    }
    expect(
      offenders,
      [
        '这些字号是随手写下的：',
        ...offenders,
        '刻度是 Tailwind 自己的那套，外加一级微字号 `text-2xs`（10px）。',
        '输入框的 16px 规矩用 `field-text`，不要写 `text-[16px]`。',
      ].join('\n'),
    ).toEqual([])
  })

  it('微字号是 10px，而且只有一级', () => {
    const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''
    expect(theme, '样式表里没有找到 @theme 这一段').not.toBe('')
    expect(
      /--text-2xs:\s*0\.625rem;/.test(theme),
      '微字号不是 10px（--text-2xs 应该是 0.625rem）',
    ).toBe(true)

    // Nothing below it. 9px is not a size a label can be, and it was in here.
    const sizes = [...CSS.matchAll(/--text-[a-z0-9-]+:\s*([\d.]+)rem/g)].map((match) =>
      Number(match[1]),
    )
    expect(sizes.length, '一个字号刻度都没读到').toBeGreaterThan(0)
    expect(
      Math.min(...sizes) * 16,
      '刻度里有一级比 10px 更小的字号',
    ).toBeGreaterThanOrEqual(10)
  })

  it('输入框的字号规矩只写在一处', () => {
    // The rule - 16px on a phone so the browser does not zoom, 14px from `md`
    // up - belongs to the stylesheet. Written into fourteen class lists it was
    // fourteen chances to get it wrong, and two of them were wrong.
    const definitions = [
      ...CSS_DEFINITIONS.filter((source) => /@utility\s+field-text\b/.test(source.text)).map(
        (source) => source.rel,
      ),
      // And in no component: a rule that belongs to the stylesheet, defined
      // twice, is a rule with two versions.
      ...SOURCES.filter(
        (source) => !isTest(source.rel) && /@utility\s+field-text\b/.test(source.text),
      ).map((source) => source.rel),
    ]
    expect(
      definitions,
      'field-text 这个规矩在不止一处被定义',
    ).toEqual(['index.css'])

    expect(
      /@media\s*\(width\s*>=\s*768px\)/.test(CSS) && /font-size:\s*0\.875rem/.test(CSS),
      'field-text 没有在 md 以上变小到 14px：桌面上它会一直停在手机的 16px',
    ).toBe(true)
  })

  it('自定义工具类的名字不会撞进 Tailwind 的命名空间', () => {
    // `tailwind-merge` reads an unknown `text-*` class as a *colour*, so a
    // utility called `text-field` was silently dropped from every class list
    // that also had a text colour - the rule was there and then was not.
    //
    // The check is the behaviour, not a list of names: a custom utility has to
    // survive a merge with a colour, or it is not a utility the way the rest
    // of the class lists think it is.
    const custom = [...CSS.matchAll(/@utility\s+([a-z0-9-]+)\b/g)].map((match) => match[1]!)
    expect(custom.length, '样式表里没有自定义工具类，这条门禁读错了地方').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const name of custom) {
      if (twMerge(`${name} text-transparent`).includes(name)) continue
      offenders.push(name)
    }

    expect(
      offenders,
      [
        '这些自定义工具类会被当成颜色类丢掉：',
        ...offenders,
        '名字不要落在 `text-` 这样的命名空间里——除非它就是一级字号。',
        '`field-text` 就是这么起的。',
      ].join('\n'),
    ).toEqual([])
  })
})
