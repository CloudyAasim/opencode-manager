import type { QueryClient } from '@tanstack/react-query'
import type { GitStatusResponse } from '@/types/git'
import { PROVIDERS_QUERY_PREFIX } from '@/api/providers'

/**
 * The keys the client files things under.
 *
 * A key is a name, and a name that is written down in two places is two names
 * waiting to drift apart. It happened: the messages used to be filed under the
 * agent's own name, then the data moved to the layer the client talks to and
 * the key moved with it - but three places kept the old spelling, and the
 * invalidations that used those spellings went on refreshing nothing at all.
 *
 * So a key that more than one file has to agree on is written down here, once.
 * The file that writes it and the file that refreshes it both take it from
 * here, and a key that is written down twice cannot be written down twice.
 *
 * The first segment says which door the answer came out of. `bff` is the
 * layer the client talks to; the rest are the manager's own doors, and some
 * of them are about the agent's own files - `opencode-config` is the agent's
 * configuration file, and it lives in the manager.
 *
 * A first segment that is just `opencode` would mean "the agent itself" -
 * and the client stopped asking the agent itself, so a key that still says so
 * is a key that was left behind when the data moved.
 */

/** The tool servers the manager knows about. */
export const MCP_SERVERS_KEY = ['mcp', 'servers'] as const

/** The commands the agent offers. They come from the layer, not from the agent. */
export const COMMANDS_KEY_PREFIX = ['bff', 'commands'] as const

/** The skills of a repository. */
export const SKILLS_KEY_PREFIX = ['settings', 'skills'] as const

/** The agent's instruction file. */
export const AGENTS_MD_KEY = ['agents-md'] as const

/**
 * The model state - the recently used and favourite models the manager keeps.
 *
 * It used to be filed under the agent's name, with the agent's address in the
 * key. The manager keeps it, and the agent's address says nothing about it:
 * two clients pointed at two agents but one manager were looking at two slots
 * for one answer.
 */
export const MODEL_STATE_KEY_PREFIX = ['model-state'] as const

/**
 * Stop whatever is in flight for these queries, and do not treat it as a
 * failure when there was something to stop.
 *
 * `cancelQueries` rejects with CancelledError whenever it actually had a
 * query running. Awaiting it bare inside `onMutate` means a background
 * refetch that happens to be in flight at that instant takes the whole
 * mutation down with it: the snapshot is never taken and `mutationFn` never
 * runs, so the click does nothing at all. The cancellation is the outcome we
 * wanted, so it is not an error.
 */
export async function stopQueries(
  queryClient: QueryClient,
  filters: Parameters<QueryClient['cancelQueries']>[0],
): Promise<void> {
  await queryClient.cancelQueries(filters).catch(() => {})
}

/**
 * The messages of one conversation, as they are cached.
 *
 * The messages come from the layer the client talks to, and they are in the
 * versioned dialect - so the key says so. They used to be filed under the
 * agent's own name, which is where they went to be asked for before they
 * moved to the layer.
 */
export function messagesQueryKey(
  serverUrl: string | null | undefined,
  sessionID: string | null | undefined,
  directory: string | null | undefined,
) {
  return ['bff', 'messages', serverUrl, sessionID, directory]
}

/**
 * The session a messages query belongs to, or null when the key is not one.
 *
 * Read off the key that `messagesQueryKey` builds rather than written out
 * here. The helper that updates a messages query by position used to spell
 * the positions out itself, and the test of that helper spelled out a literal
 * key of its own - so the two could drift apart, and the test would still
 * have been green while the helper silently stopped finding anything.
 */
export function messagesQuerySession(key: readonly unknown[]): string | null {
  // The key is the probe with its three values swapped out, so how many
  // segments it has, and which of them are fixed, is read off the probe
  // instead of assumed.
  const probe = messagesQueryKey(PROBE, PROBE, PROBE)
  const fixedSegments = probe.length - 3
  if (key.length < probe.length) return null
  for (let i = 0; i < fixedSegments; i++) {
    if (key[i] !== probe[i]) return null
  }
  const sessionID = key[fixedSegments + 1]
  return typeof sessionID === 'string' ? sessionID : null
}

/** A value that cannot be a real one, used to read a key's shape. */
const PROBE = '__probe__'

/**
 * The other two query keys of the same family, which were spelled out at
 * their call sites - three files' worth of a shape that had no owner.
 *
 * The conversation and its messages come from the layer the client talks to,
 * so they are filed under its name.
 */
export function sessionQueryKey(
  serverUrl: string | null | undefined,
  sessionID: string | null | undefined,
  directory: string | null | undefined,
) {
  return ['bff', 'session', serverUrl, sessionID, directory]
}

/**
 * The pending requests of one conversation.
 *
 * They are asked of the layer the client talks to, so they are filed under
 * its name. The agent's address used to be in the key, and the agent's
 * address says nothing about them: two clients pointed at two agents but one
 * manager were looking at two slots for one answer.
 */
export function pendingActionsQueryKey(
  sessionID: string | null | undefined,
  directory: string | null | undefined,
) {
  return ['pending-actions', sessionID, directory]
}

/**
 * The model state, as it is cached.
 *
 * It is the manager's own, so it is filed under the manager's own name - and
 * the agent's address is not part of it.
 */
export function modelStateQueryKey(directory: string | null | undefined) {
  return [...MODEL_STATE_KEY_PREFIX, directory]
}

/**
 * The commands of the agent, as they are cached.
 *
 * The commands come from the layer the client talks to, so they are filed
 * under its name.
 */
export function commandsQueryKey(serverUrl: string | null | undefined, locale: string) {
  return [...COMMANDS_KEY_PREFIX, serverUrl, locale]
}

/**
 * The skills of a repository, as they are cached.
 *
 * A repository may be named by its directory or by its number; the two are
 * different slots because they are different questions.
 */
export function skillsQueryKey(
  repoId: number | null | undefined,
  directory: string | null | undefined,
) {
  return directory
    ? [...SKILLS_KEY_PREFIX, 'directory', directory]
    : [...SKILLS_KEY_PREFIX, repoId]
}

export function invalidateProviderCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['provider-credentials'] })
  queryClient.invalidateQueries({ queryKey: ['provider-auth-methods'] })
  queryClient.invalidateQueries({ queryKey: ['providers-with-models'] })
  queryClient.invalidateQueries({ queryKey: [...PROVIDERS_QUERY_PREFIX] })
}

interface ConfigInvalidationOptions {
  skipOpenCodeConfig?: boolean
}

export function invalidateConfigCaches(
  queryClient: QueryClient,
  options: ConfigInvalidationOptions = {},
) {
  // The commands of the agent come out of its configuration, so a change to
  // the configuration has to refresh them. They used to be refreshed under the
  // agent's own name, which is where they went to be asked for before they
  // moved to the layer - so the refresh was landing on nothing, and the
  // command list kept the commands of the old configuration.
  queryClient.invalidateQueries({ queryKey: [...COMMANDS_KEY_PREFIX] })
  if (!options.skipOpenCodeConfig) {
    queryClient.invalidateQueries({ queryKey: ['opencode-config'] })
  }
  queryClient.invalidateQueries({ queryKey: ['health'] })
  queryClient.invalidateQueries({ queryKey: [...MCP_SERVERS_KEY] })
  queryClient.invalidateQueries({ queryKey: [...SKILLS_KEY_PREFIX] })
  queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  queryClient.invalidateQueries({ queryKey: ['opencode-directory-files'] })
  invalidateProviderCaches(queryClient)
}

export function refreshOpenCodeServerCaches(queryClient: QueryClient, version?: string) {
  if (version) {
    queryClient.setQueryData<Record<string, unknown>>(['health'], (oldData) => (
      oldData ? { ...oldData, opencodeVersion: version } : oldData
    ))
    queryClient.setQueryData<Record<string, unknown>>(['opencode-versions'], (oldData) => (
      oldData ? { ...oldData, currentVersion: version } : oldData
    ))
  }
  invalidateConfigCaches(queryClient)
  queryClient.invalidateQueries({ queryKey: ['opencode-versions'] })
}

export function invalidateSkillCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [...SKILLS_KEY_PREFIX] })
  queryClient.invalidateQueries({ queryKey: ['managed-skills'] })
  queryClient.invalidateQueries({ queryKey: ['health'] })
}

export function invalidateSettingsCaches(queryClient: QueryClient, userId = 'default') {
  queryClient.invalidateQueries({ queryKey: ['settings', userId] })
  invalidateConfigCaches(queryClient)
}

export function invalidateRepoListCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['repos'] })
  queryClient.invalidateQueries({ queryKey: ['reposGitStatus'] })
}

interface RepoGitInvalidationOptions {
  invalidateStatus?: boolean
  invalidateRepoMeta?: boolean
}

export function invalidateRepoGitCaches(
  queryClient: QueryClient,
  repoId?: number | null,
  options: RepoGitInvalidationOptions = {},
) {
  if (!repoId) {
    invalidateRepoListCaches(queryClient)
    queryClient.invalidateQueries({ queryKey: ['repo'] })
    queryClient.invalidateQueries({ queryKey: ['branches'] })
    queryClient.invalidateQueries({ queryKey: ['gitStatus'] })
    queryClient.invalidateQueries({ queryKey: ['gitLog'] })
    queryClient.invalidateQueries({ queryKey: ['fileDiff'] })
    return
  }

  if (options.invalidateRepoMeta ?? true) {
    queryClient.invalidateQueries({ queryKey: ['repos'] })
    queryClient.invalidateQueries({ queryKey: ['repo', repoId] })
    queryClient.invalidateQueries({ queryKey: ['branches', repoId] })
  }
  if (options.invalidateStatus ?? true) {
    queryClient.invalidateQueries({ queryKey: ['gitStatus', repoId] })
  }
  queryClient.invalidateQueries({ queryKey: ['gitLog', repoId] })
  queryClient.invalidateQueries({ queryKey: ['fileDiff', repoId] })
}

function reposGitStatusQueryIncludesRepo(queryKey: readonly unknown[], repoId: number) {
  const repoIds = queryKey[1]
  return queryKey[0] === 'reposGitStatus' && Array.isArray(repoIds) && repoIds.includes(repoId)
}

export function setRepoGitStatusCaches(queryClient: QueryClient, repoId: number, data: GitStatusResponse) {
  queryClient.setQueryData(['gitStatus', repoId], data)
  queryClient.setQueriesData<Map<number, GitStatusResponse>>(
    {
      queryKey: ['reposGitStatus'],
      predicate: (query) => reposGitStatusQueryIncludesRepo(query.queryKey, repoId),
    },
    (oldData) => {
      if (!oldData) return oldData
      const updated = new Map(oldData)
      updated.set(repoId, data)
      return updated
    },
  )
}

/** What the file list looks like right now, so a failed optimistic write can put it back. */
export function getRepoGitStatus(queryClient: QueryClient, repoId: number): GitStatusResponse | undefined {
  return queryClient.getQueryData<GitStatusResponse>(['gitStatus', repoId])
}

/** A refetch landing mid-write would stomp the local guess. Stop it first. */
export async function cancelRepoGitStatus(queryClient: QueryClient, repoId: number) {
  await stopQueries(queryClient, { queryKey: ['gitStatus', repoId] })
  await stopQueries(queryClient, { queryKey: ['reposGitStatus'] })
}

const repoGitInvalidationTimers = new WeakMap<QueryClient, Map<number, ReturnType<typeof setTimeout>>>()

export function invalidateRepoGitCachesDebounced(queryClient: QueryClient, repoId: number, delayMs = 200) {
  const existingTimers = repoGitInvalidationTimers.get(queryClient)
  const timers = existingTimers ?? new Map<number, ReturnType<typeof setTimeout>>()
  if (!existingTimers) {
    repoGitInvalidationTimers.set(queryClient, timers)
  }
  const existing = timers.get(repoId)
  if (existing) clearTimeout(existing)
  timers.set(
    repoId,
    setTimeout(() => {
      timers.delete(repoId)
      invalidateRepoGitCaches(queryClient, repoId)
    }, delayMs),
  )
}

/**
 * The session list, as it is cached.
 *
 * The list comes from the layer the client talks to, so the key says so. It
 * used to be filed under the agent's own name, which is where the list went
 * to be asked for before it moved to the layer.
 */
export function sessionListQueryKey(
  serverUrl: string | null | undefined,
  directories: string,
  options: { search?: string; limit?: number },
) {
  return ['bff', 'sessions', serverUrl, directories, options]
}

/**
 * The conversation a session query belongs to, or null when the key is not one.
 *
 * Read off the key that `sessionQueryKey` builds, the same way
 * `messagesQuerySession` reads its own - so the two cannot drift apart.
 */
export function sessionQuerySession(key: readonly unknown[]): string | null {
  const probe = sessionQueryKey(PROBE, PROBE, PROBE)
  const fixedSegments = probe.length - 3
  if (key.length < probe.length) return null
  for (let i = 0; i < fixedSegments; i++) {
    if (key[i] !== probe[i]) return null
  }
  const sessionID = key[fixedSegments + 1]
  return typeof sessionID === 'string' ? sessionID : null
}

/** Whether a query key belongs to a session list. */
export function isSessionListQueryKey(key: readonly unknown[]): boolean {
  return key[0] === 'bff' && key[1] === 'sessions'
}

export function invalidateSessionCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (query) =>
      (isSessionListQueryKey(query.queryKey) ||
        (query.queryKey[0] === 'bff' &&
          (query.queryKey[1] === 'session' || query.queryKey[1] === 'messages'))),
  })
}

export function invalidateSessionListCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (query) => isSessionListQueryKey(query.queryKey),
  })
}

const sessionListInvalidationTimers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>()

export function invalidateSessionListCachesDebounced(queryClient: QueryClient, delayMs = 200) {
  const existing = sessionListInvalidationTimers.get(queryClient)
  if (existing) clearTimeout(existing)
  sessionListInvalidationTimers.set(
    queryClient,
    setTimeout(() => {
      sessionListInvalidationTimers.delete(queryClient)
      invalidateSessionListCaches(queryClient)
    }, delayMs),
  )
}