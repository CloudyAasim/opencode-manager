import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  AGENTS_MD_KEY,
  commandsQueryKey,
  invalidateConfigCaches,
  invalidateProviderCaches,
  invalidateSkillCaches,
  MCP_SERVERS_KEY,
  messagesQueryKey,
  messagesQuerySession,
  modelStateQueryKey,
  pendingActionsQueryKey,
  refreshOpenCodeServerCaches,
  sessionQueryKey,
  SKILLS_KEY_PREFIX,
  skillsQueryKey,
} from './queryInvalidation'
import { providersQueryKey } from '@/api/providers'

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
    expect(messagesQuerySession(pendingActionsQueryKey('ses-1', '/repo')))
      .toBeNull()
  })

  it('says no for a key that is too short', () => {
    expect(messagesQuerySession(['bff', 'messages'])).toBeNull()
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

describe('失效落在真东西上', () => {
  /** A cache with one entry per thing the client keeps. */
  function cacheWithEverything() {
    const queryClient = new QueryClient()
    const slots: Record<string, readonly unknown[]> = {
      目录: providersQueryKey('/repo'),
      命令: commandsQueryKey('http://localhost:5551', 'en'),
      工具服务器: MCP_SERVERS_KEY,
      技能: skillsQueryKey(1, null),
      指令文件: AGENTS_MD_KEY,
      配置文件: ['opencode-config', 'file'],
      模型状态: modelStateQueryKey('/repo'),
      消息: messagesQueryKey('http://localhost:5551', 'ses-1', '/repo'),
      待办: pendingActionsQueryKey('ses-1', '/repo'),
    }
    for (const key of Object.values(slots)) queryClient.setQueryData(key, { any: true })
    return { queryClient, slots }
  }

  const refreshed = (
    queryClient: QueryClient,
    slots: Record<string, readonly unknown[]>,
    names: string[],
  ) =>
    names.filter((name) => queryClient.getQueryState(slots[name]!)?.isInvalidated !== true)

  it('改了配置，命令、工具服务器、技能、目录都要重新问一遍', () => {
    // These are the ones that were refreshed under a name nobody had written
    // to, so the refresh landed on nothing: the command list kept the
    // commands of the old configuration, and a tool server that had just
    // been added never showed up.
    const { queryClient, slots } = cacheWithEverything()

    invalidateConfigCaches(queryClient)

    expect(
      refreshed(queryClient, slots, ['命令', '工具服务器', '技能', '目录', '配置文件']),
      '这些没有重新问一遍',
    ).toEqual([])
  })

  it('改了配置，指令文件、模型状态、消息、待办不受影响', () => {
    // The other way round: a refresh that reaches too much is as wrong as one
    // that reaches nothing.
    const { queryClient, slots } = cacheWithEverything()

    invalidateConfigCaches(queryClient)

    expect(
      refreshed(queryClient, slots, ['指令文件', '模型状态', '消息', '待办']),
      '这些本来不该被刷新，却刷新了',
    ).toEqual(['指令文件', '模型状态', '消息', '待办'])
  })

  it('动了凭据，目录要重新问一遍', () => {
    const { queryClient, slots } = cacheWithEverything()

    invalidateProviderCaches(queryClient)

    expect(refreshed(queryClient, slots, ['目录']), '目录没有重新问一遍').toEqual([])
  })

  it('动了技能，技能要重新问一遍', () => {
    const { queryClient, slots } = cacheWithEverything()

    invalidateSkillCaches(queryClient)

    expect(refreshed(queryClient, slots, ['技能']), '技能没有重新问一遍').toEqual([])
  })

  it('技能那一族的名字是一个', () => {
    expect(SKILLS_KEY_PREFIX).toEqual(['settings', 'skills'])
    expect(skillsQueryKey(7, null)).toEqual(['settings', 'skills', 7])
    expect(skillsQueryKey(7, '/repo')).toEqual(['settings', 'skills', 'directory', '/repo'])
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
    // The commands come out of the configuration, so they are one of the
    // dependents - and they used to be refreshed under a name nothing had
    // been written to, so the refresh did nothing at all.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bff', 'commands'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] })
  })
})
