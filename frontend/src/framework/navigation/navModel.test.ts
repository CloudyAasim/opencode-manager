import { describe, it, expect } from 'vitest'
import { buildMoreItems, buildNavModel, isNavItemActive } from './navModel'

const GLOBAL_KEYS = ['projects', 'assistant', 'files', 'schedules', 'settings', 'logout']
const TOOL_KEYS = ['mcp', 'skills', 'source-control', 'schedules', 'reset-permissions']

function keys(items: ReturnType<typeof buildMoreItems>) {
  return items.map((item) => item.key)
}

describe('buildNavModel', () => {
  it('returns the fixed global set', () => {
    const { items } = buildNavModel()
    expect(keys(items)).toEqual(GLOBAL_KEYS)
  })

  it('routes projects and assistant to their pages', () => {
    const { items } = buildNavModel()
    expect(items.find((item) => item.key === 'projects')?.to).toBe('/')
    expect(items.find((item) => item.key === 'assistant')?.to).toBe('/assistant')
    expect(items.find((item) => item.key === 'files')?.to).toBe('/files')
    expect(items.find((item) => item.key === 'settings')?.to).toBe('/settings')
  })

  it('hides the terminal for non-admins by default', () => {
    const { items } = buildNavModel()
    expect(items.some((item) => item.key === 'terminal')).toBe(false)
  })

  it('shows the terminal for admins', () => {
    const { items } = buildNavModel({ isAdmin: true })
    expect(items.some((item) => item.key === 'terminal')).toBe(true)
  })

  it('shows the terminal for non-admins when the server allows it', () => {
    const { items } = buildNavModel({ terminalAllowed: true })
    expect(items.some((item) => item.key === 'terminal')).toBe(true)
  })
})

describe('buildMoreItems', () => {
  it('returns only the global set outside a project', () => {
    expect(keys(buildMoreItems('/'))).toEqual(GLOBAL_KEYS)
    expect(keys(buildMoreItems('/schedules'))).toEqual(GLOBAL_KEYS)
    expect(keys(buildMoreItems('/unknown/path'))).toEqual(GLOBAL_KEYS)
  })

  it('adds project tooling inside a project', () => {
    for (const path of ['/repos/42', '/repos/42/sessions/abc', '/repos/42/assistant', '/assistant']) {
      // the project already has its own Schedules, so the global one steps aside
      const withoutGlobalSchedules = GLOBAL_KEYS.filter((key) => key !== 'schedules')
      expect(keys(buildMoreItems(path))).toEqual([...TOOL_KEYS, ...withoutGlobalSchedules])
    }
  })

  it('never shows two rows both reading Schedules', () => {
    for (const path of ['/', '/repos/42', '/repos/42/sessions/abc', '/assistant', '/unknown']) {
      const labels = buildMoreItems(path).map((item) => item.labelKey ?? item.label)
      expect(
        labels.filter((label) => label === 'navigation.schedules'),
        'two Schedules rows in ' + path,
      ).toHaveLength(1)
    }
  })

  it('links schedules to the current project', () => {
    const schedules = buildMoreItems('/repos/42').find((item) => item.key === 'schedules')
    expect(schedules?.to).toBe('/repos/42/schedules')

    const assistantSchedules = buildMoreItems('/assistant').find((item) => item.key === 'schedules')
    expect(assistantSchedules?.to).toBe('/repos/0/schedules')
  })

  it('marks the destinations that stay inline, and nothing else', () => {
    const { items } = buildNavModel()
    expect(items.filter((item) => item.primary).map((item) => item.key)).toEqual([
      'projects',
      'assistant',
      'files',
      'schedules',
    ])
  })

  it('decides what is current from the item, not from a route switch', () => {
    const byKey = Object.fromEntries(buildNavModel().items.map((item) => [item.key, item]))
    expect(isNavItemActive(byKey.projects!, '/')).toBe(true)
    expect(isNavItemActive(byKey.projects!, '/files')).toBe(false)
    expect(isNavItemActive(byKey.assistant!, '/assistant')).toBe(true)
    expect(isNavItemActive(byKey.assistant!, '/repos/3/assistant')).toBe(true)
    expect(isNavItemActive(byKey.files!, '/files')).toBe(true)
    // a route nobody planned for highlights nothing - and hides nothing
    expect(isNavItemActive(byKey.schedules!, '/repos/3/sessions/s1')).toBe(false)
  })

  it('marks reset permissions as dangerous', () => {
    const reset = buildMoreItems('/repos/42').find((item) => item.key === 'reset-permissions')
    expect(reset?.danger).toBe(true)
  })
})
