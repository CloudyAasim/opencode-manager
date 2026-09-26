import { describe, it, expect } from 'vitest'
import { buildMoreItems, buildNavModel } from './moreDrawerItems'

const RAIL_KEYS = ['projects', 'assistant', 'files', 'settings', 'logout']
const TOOL_KEYS = ['mcp', 'skills', 'source-control', 'schedules', 'reset-permissions']

function keys(items: ReturnType<typeof buildMoreItems>) {
  return items.map((item) => item.key)
}

describe('buildNavModel', () => {
  it('returns the fixed global rail', () => {
    const { items } = buildNavModel()
    expect(keys(items)).toEqual(RAIL_KEYS)
  })

  it('routes projects and assistant to their pages', () => {
    const { items } = buildNavModel()
    expect(items.find((item) => item.key === 'projects')?.to).toBe('/')
    expect(items.find((item) => item.key === 'assistant')?.to).toBe('/assistant')
    expect(items.find((item) => item.key === 'files')?.dialog).toBe('files')
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
  it('returns only the global rail outside a project', () => {
    expect(keys(buildMoreItems('/'))).toEqual(RAIL_KEYS)
    expect(keys(buildMoreItems('/schedules'))).toEqual(RAIL_KEYS)
    expect(keys(buildMoreItems('/unknown/path'))).toEqual(RAIL_KEYS)
  })

  it('adds project tooling inside a project', () => {
    for (const path of ['/repos/42', '/repos/42/sessions/abc', '/repos/42/assistant', '/assistant']) {
      expect(keys(buildMoreItems(path))).toEqual([...TOOL_KEYS, ...RAIL_KEYS])
    }
  })

  it('links schedules to the current project', () => {
    const schedules = buildMoreItems('/repos/42').find((item) => item.key === 'schedules')
    expect(schedules?.to).toBe('/repos/42/schedules')

    const assistantSchedules = buildMoreItems('/assistant').find((item) => item.key === 'schedules')
    expect(assistantSchedules?.to).toBe('/repos/0/schedules')
  })

  it('marks reset permissions as dangerous', () => {
    const reset = buildMoreItems('/repos/42').find((item) => item.key === 'reset-permissions')
    expect(reset?.danger).toBe(true)
  })
})
