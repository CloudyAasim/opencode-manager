import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildImportGraph, relativeTo } from './import-graph'

/**
 * A heading, a line under it, and something on the right - drawn once.
 *
 * That shape was written out by hand in six places: the settings pages and
 * the terminal. Every one of them had already made its own decision about
 * the spacing. Some put `mt-1` under the title and some did not; one aligned
 * its button to the middle of the two lines and the rest to the top; one
 * described its subject in `text-xs` and the others in `text-sm`.
 *
 * The settings panels had a second problem: `SettingsPanel` already draws the
 * title, and the panel drew it *again* inside itself, so the screen said
 * "Shortcuts" twice.
 */

const FRONTEND_SRC = path.resolve(__dirname, '../..')

const graph = buildImportGraph(FRONTEND_SRC, [['@', FRONTEND_SRC]])

const SOURCES = graph.files.map((file) => ({
  rel: relativeTo(graph, file),
  text: fs.readFileSync(file, 'utf8'),
}))

const isTest = (rel: string) => rel.includes('.test.')

/**
 * The owner of the shape.
 *
 * And the two places that draw a heading of their own and say why: the
 * settings card, whose title belongs to the card, and the Git settings
 * panel, whose heading is a *card* header - a strip with a rule under it -
 * rather than a heading on the page.
 */
const OWNER = 'components/ui/section-header.tsx'

const NOT_A_SECTION: ReadonlyArray<readonly [string, string]> = [
  [
    'features/settings/SettingsPanel.tsx',
    '卡片自己的标题，它属于卡片而不是页面的一节',
  ],
  [
    'features/settings/GitSettings.tsx',
    '卡片自己的标题条（下面有一条分隔线），不是页面的一节',
  ],
]

/**
 * The shape of a hand-drawn section heading.
 *
 * A row that puts things on either side of it, a heading in the row, and a
 * dimmer line under that heading. All three, because a heading alone is a
 * card title and a row alone is a toolbar.
 */
const ROW = /<div className="[^"]*\bjustify-between\b[^"]*"[^>]*>/g
const HEADING_IN_ROW = /<h[12][^>]*className="[^"]*\bfont-semibold\b[^"]*"[^>]*>/

/** The heading that sits in a row, and the dimmer line under it. */
function handDrawnSections(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(ROW)) {
    const body = text.slice(match.index, match.index + 900)
    if (!HEADING_IN_ROW.test(body)) continue
    if (!/text-sm[^"]*text-muted-foreground|text-muted-foreground[^"]*text-sm/.test(body)) continue
    found.push(body.slice(0, 120).replace(/\s+/g, ' ').trim())
  }
  return found
}

describe('页面标题栏只有一副', () => {
  it('门禁自己看得见东西', () => {
    expect(SOURCES.length, '源文件少得可疑，这道门禁多半跑在空集上').toBeGreaterThan(300)
    expect(
      SOURCES.some((source) => source.rel === OWNER),
      `找不到 ${OWNER}`,
    ).toBe(true)
    expect(
      handDrawnSections(
        '<div className="flex justify-between"><h2 className="text-lg font-semibold">x</h2><p className="text-sm text-muted-foreground">y</p></div>',
      ).length,
      '认不出手写的那一套标题栏',
    ).toBe(1)
  })

  it('没有人再自己画这一套标题栏', () => {
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (isTest(source.rel)) continue
      if (source.rel === OWNER) continue
      if (NOT_A_SECTION.some(([rel]) => rel === source.rel)) continue
      const found = handDrawnSections(source.text)
      if (found.length === 0) continue
      offenders.push(`${source.rel}\n    ${found.join('\n    ')}`)
    }

    expect(
      offenders,
      [
        `这些文件自己画了标题栏：${offenders.length} 处`,
        ...offenders,
        '用 <SectionHeader title=... description=... actions=... />：',
        '标题多大、说明离标题多远、右边的按钮和标题还是和说明对齐，都只该有一处决定。',
      ].join('\n'),
    ).toEqual([])
  })

  it('例外都写明了为什么', () => {
    for (const [rel, reason] of NOT_A_SECTION) {
      expect(reason.trim().length, `${rel} 没有写为什么可以不算`).toBeGreaterThan(0)
      expect(
        SOURCES.some((source) => source.rel === rel),
        `例外里的 ${rel} 不存在了，这条该删`,
      ).toBe(true)
    }
  })

  it('共享组件自己带着那套排版', () => {
    // The decisions - how big the title is, how far the description sits
    // under it, whether the actions line up with the title or with the middle
    // of the block - are made here, once. Pinning them here is what makes
    // "one header" mean something.
    const owner = SOURCES.find((source) => source.rel === OWNER)!.text
    expect(owner, '标题的字号不在组件里').toContain('text-lg font-semibold')
    expect(owner, '说明与标题之间的距离不在组件里').toContain('mt-1 text-sm text-muted-foreground')
    // The actions line up with the title, not with the middle of the two
    // lines: a button floating half a title down reads as belonging to the
    // description.
    expect(owner, '右侧的动作没有和标题对齐').toContain('items-start')
  })

  it('一个面板不会把它的标题画两遍', () => {
    // `SettingsPanel` draws the title. A panel that draws it again inside
    // itself says it twice, and the second copy is the one that reads as an
    // accident.
    const offenders: string[] = []
    for (const source of SOURCES) {
      if (isTest(source.rel)) continue
      const panels = [...source.text.matchAll(/<SettingsPanel\b[^>]*>/g)]
      for (const panel of panels) {
        const body = source.text.slice(panel.index, panel.index + 700)
        if (!/<h[12][^>]*>/.test(body)) continue
        offenders.push(`${source.rel}: ${body.slice(0, 100).replace(/\s+/g, ' ').trim()}`)
      }
    }

    expect(
      offenders,
      [
        `这些面板把标题画了两遍：${offenders.length} 处`,
        ...offenders,
        'SettingsPanel 已经带着标题了，面板里面不要再画一个。',
      ].join('\n'),
    ).toEqual([])
  })
})
