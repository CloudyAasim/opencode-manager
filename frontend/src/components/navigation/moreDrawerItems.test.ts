import { describe, it, expect } from 'vitest'
import { buildMoreItems } from './moreDrawerItems'

describe('buildMoreItems', () => {
  it('returns only Settings + Logout for root path', () => {
    const items = buildMoreItems('/')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns repo-specific items with memory when plugin enabled for /repos/:id', () => {
    const items = buildMoreItems('/repos/42', { memoryPluginEnabled: true })
    expect(items).toHaveLength(9)
    expect(items[0].key).toBe('files')
    expect(items[0].dialog).toBe('files')
    expect(items[1].key).toBe('memory')
    expect(items[1].to).toBe('/repos/42/memories')
    expect(items[2].key).toBe('mcp')
    expect(items[2].dialog).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[3].dialog).toBe('skills')
    expect(items[4].key).toBe('reset-permissions')
    expect(items[4].dialog).toBe('resetPermissions')
    expect(items[4].danger).toBe(true)
    expect(items[5].key).toBe('schedules')
    expect(items[5].to).toBe('/repos/42/schedules')
    expect(items[6].key).toBe('source-control')
    expect(items[6].dialog).toBe('sourceControl')
    expect(items[7].key).toBe('settings')
    expect(items[8].key).toBe('logout')
  })

  it('omits memory item for /repos/:id when plugin disabled', () => {
    const items = buildMoreItems('/repos/42')
    expect(items).toHaveLength(8)
    expect(items.some((item) => item.key === 'memory')).toBe(false)
    expect(items[0].key).toBe('files')
    expect(items[1].key).toBe('mcp')
  })

  it('returns session-specific items with memory when plugin enabled for /repos/:id/sessions/:sid', () => {
    const items = buildMoreItems('/repos/42/sessions/abc', { memoryPluginEnabled: true })
    expect(items).toHaveLength(9)
    expect(items[0].key).toBe('files')
    expect(items[1].key).toBe('memory')
    expect(items[2].key).toBe('mcp')
    expect(items[3].key).toBe('skills')
    expect(items[4].key).toBe('lsp')
    expect(items[4].dialog).toBe('lsp')
    expect(items[5].key).toBe('reset-permissions')
    expect(items[6].key).toBe('source-control')
    expect(items[7].key).toBe('settings')
    expect(items[8].key).toBe('logout')
  })

  it('omits memory item for /repos/:id/sessions/:sid when plugin disabled', () => {
    const items = buildMoreItems('/repos/42/sessions/abc')
    expect(items).toHaveLength(8)
    expect(items.some((item) => item.key === 'memory')).toBe(false)
    expect(items[0].key).toBe('files')
    expect(items[1].key).toBe('mcp')
  })

  it('returns only Settings + Logout for /repos/:id/memories', () => {
    const items = buildMoreItems('/repos/42/memories')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns only Settings + Logout for /schedules', () => {
    const items = buildMoreItems('/schedules')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns only Settings + Logout for /repos/:id/schedules', () => {
    const items = buildMoreItems('/repos/42/schedules')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })

  it('returns only Settings + Logout for unknown paths', () => {
    const items = buildMoreItems('/unknown/path')
    expect(items).toHaveLength(2)
    expect(items[0].key).toBe('settings')
    expect(items[1].key).toBe('logout')
  })
})
