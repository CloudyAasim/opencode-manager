import { describe, expect, it } from 'vitest'
import {
  DEFAULT_USER_PREFERENCES,
  UserPreferencesSchema,
} from '@opencode-manager/shared'

const base = { ...DEFAULT_USER_PREFERENCES, customAgents: [] as unknown[] }

/**
 * `toggleSidebar` stopped toggling a sidebar when the sidebar was removed - it
 * toggles the file browser - but the settings panel builds its label by
 * humanising the action id, so the row kept reading "toggle Sidebar" and B was
 * labelled with a panel that has not existed for a while. Renaming the action
 * fixes the label, and preferences are a persisted per-user record, so the
 * rename has to happen where they are parsed or anyone who had moved B would
 * silently lose their binding.
 */
describe('快捷键动作改名的迁移', () => {
  it('把旧的 toggleSidebar 键搬到 toggleFileBrowser', () => {
    const parsed = UserPreferencesSchema.parse({
      ...base,
      keyboardShortcuts: { ...base.keyboardShortcuts, toggleSidebar: 'Ctrl+B' },
    })
    expect(parsed.keyboardShortcuts.toggleFileBrowser).toBe('Ctrl+B')
    expect('toggleSidebar' in parsed.keyboardShortcuts).toBe(false)
  })

  it('免 leader 的动作列表里也搬', () => {
    const parsed = UserPreferencesSchema.parse({
      ...base,
      directShortcuts: ['submit', 'toggleSidebar'],
    })
    expect(parsed.directShortcuts).toEqual(['submit', 'toggleFileBrowser'])
  })

  it('新装的不受影响，也不会凭空多出一个键', () => {
    const parsed = UserPreferencesSchema.parse(base)
    expect(parsed.keyboardShortcuts.toggleFileBrowser).toBe('B')
    expect('toggleSidebar' in parsed.keyboardShortcuts).toBe(false)
  })

  it('默认带来的新键不会挡住旧键迁移', () => {
    // base.keyboardShortcuts already carries toggleFileBrowser: 'B' from the
    // defaults, so a migration that gives up when the new key is present never
    // fires at all. The legacy chord is the one the user actually chose.
    const parsed = UserPreferencesSchema.parse({
      ...base,
      keyboardShortcuts: { ...base.keyboardShortcuts, toggleSidebar: 'X' },
    })
    expect(parsed.keyboardShortcuts.toggleFileBrowser).toBe('X')
    expect('toggleSidebar' in parsed.keyboardShortcuts).toBe(false)
  })

  it('可选字段缺省时照旧是 undefined', () => {
    const parsed = UserPreferencesSchema.parse({ ...base, directShortcuts: undefined })
    expect(parsed.directShortcuts).toBeUndefined()
  })
})
