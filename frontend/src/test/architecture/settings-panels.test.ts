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

const SETTINGS_DIALOG = 'features/settings/SettingsDialog.tsx'

// Every panel the settings screen can show. The dialog used to enumerate this
// list twice - once for the desktop tabs, once for the mobile view - so a new
// setting had to be added in two places and forgetting the second one meant it
// silently never appeared on a phone.
const PANELS = [
  'AccountSettings',
  'GeneralSettings',
  'NotificationSettings',
  'VoiceSettings',
  'GitSettings',
  'KeyboardShortcuts',
  'OpenCodeSettings',
  'LogsViewer',
  'ProviderSettings',
  'UsersSettings',
  'AuditSettings',
] as const

describe('设置面板只写一次', () => {
  it('门禁看得见它要守的那些面板', () => {
    const dialog = SOURCES.find((source) => source.rel === SETTINGS_DIALOG)
    expect(dialog, `找不到 ${SETTINGS_DIALOG}`).toBeDefined()
    const missing = PANELS.filter((panel) => !dialog!.text.includes(`<${panel}`))
    expect(missing, '这些面板在对话框里找不到了，规则可能已经过期').toEqual([])
  })

  it('每个面板在对话框里只被挂一次', () => {
    const dialog = SOURCES.find((source) => source.rel === SETTINGS_DIALOG)!.text
    const offenders = PANELS.filter(
      (panel) => (dialog.match(new RegExp(`<${panel}[\\s/>]`, 'g')) ?? []).length !== 1,
    )
    expect(
      offenders,
      [
        `这些面板被挂了不止一次：${offenders.length} 处`,
        ...offenders,
        '桌面和移动端必须从同一份菜单清单渲染，而不是各写一遍。',
      ].join('\n'),
    ).toEqual([])
  })

  it('桌面和移动端都从 menuItems 渲染', () => {
    const dialog = SOURCES.find((source) => source.rel === SETTINGS_DIALOG)!.text
    const fromMenu = (dialog.match(/menuItems\.map\(/g) ?? []).length
    // 标签栏、移动端菜单、桌面面板、移动端面板，四处都从同一份清单出发。
    expect(fromMenu, '菜单清单只被用了少数几次，两棵树可能又分开了').toBeGreaterThanOrEqual(4)
    expect(dialog).toMatch(/menuItems\.map\(\(item\) => \(\s*<TabsContent/)
    expect(dialog).toMatch(/menuItems\.map\(\(item\) => \(\s*mobileView === item\.id/)
  })
})
