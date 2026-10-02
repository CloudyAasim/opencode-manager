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

const OWNER = 'features/settings/SettingsPanel.tsx'

// Seven settings panels drew the same card-with-a-title by hand, and the
// title's bottom margin had already split into mb-4 and mb-6. The two cards
// in NotificationSettings that carry a min-w-0 prefix are nested sub-sections
// with their own titles, so the exact class string is what identifies a panel
// and they stay out of it.
const PANEL_CARD = 'className="bg-card border border-border rounded-lg p-6"'

const PANELS = [
  'features/settings/NotificationSettings.tsx',
  'features/settings/STTSettings.tsx',
  'features/settings/TTSSettings.tsx',
  'features/settings/KeyboardShortcuts.tsx',
]

describe('设置面板只有一副卡片', () => {
  it('门禁看得见共享组件和那四个文件', () => {
    expect(SOURCES.some((source) => source.rel === OWNER), `找不到 ${OWNER}`).toBe(true)
    const users = SOURCES.filter((source) => source.text.includes('<SettingsPanel ')).map(
      (source) => source.rel,
    )
    expect(users.length, '没有面板在用共享组件，规则可能已经过期').toBeGreaterThan(3)
  })

  it('没人再自己画这张卡片', () => {
    const offenders = SOURCES.filter(
      (source) => source.rel !== OWNER && source.text.includes(PANEL_CARD),
    ).map((source) => source.rel)
    expect(
      offenders,
      [
        `这些文件自己画了设置面板的卡片：${offenders.length} 处`,
        ...offenders,
        '用 <SettingsPanel title=... />，右侧有内容就传 actions。',
        '带 min-w-0 前缀的是嵌套子卡片，不算。',
      ].join('\n'),
    ).toEqual([])
  })

  it('共享组件自己带着那套类名', () => {
    const owner = SOURCES.find((source) => source.rel === OWNER)!.text
    expect(owner).toContain('bg-card border border-border rounded-lg p-6')
    expect(owner).toContain('text-lg font-semibold text-foreground mb-6')
    expect(owner).toContain('flex items-center justify-between mb-6')
  })

  it('那两个文件确实还在用共享组件', () => {
    for (const rel of PANELS) {
      const source = SOURCES.find((entry) => entry.rel === rel)
      expect(source, `找不到 ${rel}`).toBeDefined()
      expect(source!.text, `${rel} 没有用共享面板`).toContain('<SettingsPanel ')
    }
  })
})
