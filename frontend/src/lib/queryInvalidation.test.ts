import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  invalidateConfigCaches,
  messagesQueryKey,
  messagesQuerySession,
  pendingActionsQueryKey,
  refreshOpenCodeServerCaches,
  sessionQueryKey,
} from './queryInvalidation'

describe('messagesQuerySession', () => {
  it('reads the session out of a key built by messagesQueryKey', () => {
    expect(messagesQuerySession(messagesQueryKey('http://localhost:5551', 'ses-1', '/repo')))
      .toBe('ses-1')
  })

  it('says no for a key of another family', () => {
    // The session query carries the same session id, so a reader that only
    // looked for "a key with this session in it" would edit the wrong entry.
    expect(messagesQuerySession(sessionQueryKey('http://localhost:5551', 'ses-1', '/repo')))
      .toBeNull()
    expect(messagesQuerySession(pendingActionsQueryKey('http://localhost:5551', 'ses-1', '/repo')))
      .toBeNull()
  })

  it('says no for a key that is too short', () => {
    expect(messagesQuerySession(['opencode', 'messages'])).toBeNull()
  })

  it('says no for a key whose session slot is not a string', () => {
    const key = messagesQueryKey('http://localhost:5551', 'ses-1', '/repo')
    key[3] = 42
    expect(messagesQuerySession(key)).toBeNull()
  })
})

describe('refreshOpenCodeServerCaches', () => {
  it('invalidates every cache that displays the installed OpenCode version', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    refreshOpenCodeServerCaches(queryClient)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-versions'] })
  })

  it('updates both OpenCode version caches when the new version is known', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['health'], { opencodeVersion: '1.0.0', status: 'healthy' })
    queryClient.setQueryData(['opencode-versions'], { currentVersion: '1.0.0', versions: [] })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    refreshOpenCodeServerCaches(queryClient, '1.0.1')

    expect(queryClient.getQueryData(['health'])).toEqual({ opencodeVersion: '1.0.1', status: 'healthy' })
    expect(queryClient.getQueryData(['opencode-versions'])).toEqual({ currentVersion: '1.0.1', versions: [] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-versions'] })
  })
})

describe('invalidateConfigCaches', () => {
  it('invalidates the OpenCode config file cache by default', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateConfigCaches(queryClient)

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
  })

  it('skips the OpenCode config file cache while still invalidating dependents', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateConfigCaches(queryClient, { skipOpenCodeConfig: true })

    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'config'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
  })
})
