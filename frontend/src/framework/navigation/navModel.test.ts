import { describe, it, expect } from 'vitest'
import {
  buildGlobalMoreItems,
  buildNavModel,
  buildProjectToolItems,
  isNavItemActive,
} from './navModel'

const GLOBAL_KEYS = ['projects', 'assistant', 'files', 'schedules', 'settings', 'logout']
const TOOL_KEYS = ['mcp', 'skills', 'source-control', 'schedules', 'reset-permissions']

function keys(items: ReturnType<typeof buildGlobalMoreItems>) {
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

describe('the two phone drawers', () => {
  it('the global drawer lists only places you can go', () => {
    // It no longer takes a pathname at all. It used to, and used it to decide
    // whether to prepend the project's tools - which is how five rows of
    // project furniture ended up inside the app's navigation menu.
    expect(keys(buildGlobalMoreItems())).toEqual(GLOBAL_KEYS)
  })

  it('the project drawer lists only what you can do to this project', () => {
    for (const path of ['/repos/42', '/repos/42/sessions/abc', '/repos/42/assistant', '/assistant']) {
      expect(keys(buildProjectToolItems(path)), path).toEqual(TOOL_KEYS)
    }
  })

  it('the project drawer is empty away from a project', () => {
    for (const path of ['/', '/schedules', '/files', '/unknown/path']) {
      expect(buildProjectToolItems(path), path).toEqual([])
    }
  })

  it('the two drawers do not both offer the same destination', () => {
    // The regression this split exists for. On a session page the global menu
    // showed MCP, Skills, Source Control, Schedules and Reset Permissions above
    // Projects, Assistant, Settings and Logout.
    const global = buildGlobalMoreItems()
    const project = buildProjectToolItems('/repos/42/sessions/abc')

    // `schedules` is allowed to appear in both, and is the one key that does.
    // The two rows are different places - the global one is /schedules, the
    // project's is /repos/42/schedules - and they only ever collided because
    // the old union put them next to each other in one list. Anything else
    // appearing in both is the bug coming back.
    const sharedKeys = global.map((item) => item.key).filter((key) => project.some((item) => item.key === key))
    expect(sharedKeys).toEqual(['schedules'])
    for (const key of sharedKeys) {
      expect(global.find((item) => item.key === key)?.to).not.toBe(
        project.find((item) => item.key === key)?.to,
      )
    }
  })

  it('each drawer offers Schedules exactly once, and not the same one', () => {
    const count = (items: ReturnType<typeof buildGlobalMoreItems>) =>
      items.filter((item) => (item.labelKey ?? item.label) === 'navigation.schedules')

    const global = count(buildGlobalMoreItems())
    const project = count(buildProjectToolItems('/repos/42/sessions/abc'))
    expect(global).toHaveLength(1)
    expect(project).toHaveLength(1)
    expect(global[0]?.to).toBe('/schedules')
    expect(project[0]?.to).toBe('/repos/42/schedules')
  })

  it('links schedules to the current project', () => {
    const schedules = buildProjectToolItems('/repos/42').find((item) => item.key === 'schedules')
    expect(schedules?.to).toBe('/repos/42/schedules')

    const assistantSchedules = buildProjectToolItems('/assistant').find((item) => item.key === 'schedules')
    expect(assistantSchedules?.to).toBe('/repos/0/schedules')
  })

  it('marks the destinations that stay inline, and nothing else', () => {
    // No options: terminal needs one of the two conditions, so it is absent and
    // the inline set is the five places that are always reachable.
    const { items } = buildNavModel()
    expect(items.filter((item) => item.primary).map((item) => item.key)).toEqual([
      'projects',
      'assistant',
      'files',
      'schedules',
      'settings',
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
    const reset = buildProjectToolItems('/repos/42').find((item) => item.key === 'reset-permissions')
    expect(reset?.danger).toBe(true)
  })
})
