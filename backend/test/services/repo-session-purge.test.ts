import { describe, expect, it } from 'vitest'
import {
  purgeSessionsForDirectory,
  type SessionPurgeClient,
} from '../../src/services/repo/session-purge'

const DIRECTORY = '/workspace/users/aasim/workspace/repos/demo'

interface ListCall {
  path: string
  directory?: string
}

interface DeleteCall {
  method: string
  path: string
  directory?: string
}

/**
 * Every test builds its own client. Nothing here is shared between tests, so
 * there is no ordering to get wrong - which is the failure I already paid for
 * once in this repo.
 */
function makeClient(options: {
  pages?: unknown[]
  listError?: Error
  deleteErrors?: Record<string, Error>
  deleteNotOk?: string[]
  cursorFor?: (pageIndex: number) => string | undefined
} = {}) {
  const listCalls: ListCall[] = []
  const deleteCalls: DeleteCall[] = []
  let pageIndex = 0

  const client = {
    getJson: async (path: string, opts?: { directory?: string }) => {
      listCalls.push({ path, directory: opts?.directory })
      if (options.listError) throw options.listError

      const index = pageIndex
      pageIndex += 1

      const page = (options.pages?.[index] ?? {}) as Record<string, unknown>
      const extra = options.cursorFor?.(index)
      return extra ? { ...page, cursor: { next: extra } } : page
    },
    forward: async (req: DeleteCall) => {
      deleteCalls.push(req)
      const id = decodeURIComponent(req.path.replace(/^\/session\//, ''))

      const thrown = options.deleteErrors?.[id]
      if (thrown) throw thrown

      if (options.deleteNotOk?.includes(id)) {
        return new Response(JSON.stringify({ error: 'refused' }), { status: 500 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    },
  }

  return { client: client as unknown as SessionPurgeClient, listCalls, deleteCalls }
}

describe('purgeSessionsForDirectory', () => {
  it('deletes every session OpenCode lists for that directory', async () => {
    const { client, listCalls, deleteCalls } = makeClient({
      pages: [{ data: [{ id: 'ses_a' }, { id: 'ses_b' }] }],
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result).toEqual({ listed: 2, deleted: 2, failed: [], truncated: false })
    expect(deleteCalls.map((call) => call.path)).toEqual(['/session/ses_a', '/session/ses_b'])
    expect(deleteCalls.every((call) => call.method === 'DELETE')).toBe(true)
    // The directory has to travel with both calls. OpenCode files sessions
    // under it; a delete without it is a delete against the wrong scope.
    expect(listCalls[0]?.directory).toBe(DIRECTORY)
    expect(deleteCalls.every((call) => call.directory === DIRECTORY)).toBe(true)
  })

  it('asks for the paged list endpoint with an explicit page size', async () => {
    const { client, listCalls } = makeClient({ pages: [{ data: [] }] })

    await purgeSessionsForDirectory(client, DIRECTORY, { pageSize: 25 })

    // Parsed rather than substring-matched on purpose: `/api/session-list`
    // also *contains* `/api/session`, so a toContain here accepts the wrong
    // endpoint and the mutation survives.
    const url = new URL(listCalls[0]!.path, 'http://opencode.test')

    expect(url.pathname).toBe('/api/session')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.has('cursor')).toBe(false)
  })

  it('reads the `items` shape as well as `data`', async () => {
    const { client, deleteCalls } = makeClient({ pages: [{ items: [{ id: 'ses_x' }] }] })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result.deleted).toBe(1)
    expect(deleteCalls[0]?.path).toBe('/session/ses_x')
  })

  it('follows the cursor so sessions on later pages are deleted too', async () => {
    const { client, listCalls } = makeClient({
      pages: [{ data: [{ id: 'ses_a' }], cursor: { next: 'c1' } }, { data: [{ id: 'ses_b' }] }],
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result).toMatchObject({ listed: 2, deleted: 2, truncated: false })
    expect(listCalls).toHaveLength(2)
    const second = new URL(listCalls[1]!.path, 'http://opencode.test')
    expect(second.pathname).toBe('/api/session')
    expect(second.searchParams.get('cursor')).toBe('c1')
  })

  it('reports a failed list as incomplete instead of pretending the purge was clean', async () => {
    const { client, deleteCalls } = makeClient({ listError: new Error('opencode is down') })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result).toEqual({ listed: 0, deleted: 0, failed: [], truncated: true })
    expect(deleteCalls).toHaveLength(0)
  })

  it('never throws when OpenCode cannot be reached', async () => {
    const { client } = makeClient({ listError: new Error('socket hang up') })

    await expect(purgeSessionsForDirectory(client, DIRECTORY)).resolves.toBeDefined()
  })

  it('keeps going when one session refuses to be deleted', async () => {
    const { client, deleteCalls } = makeClient({
      pages: [{ data: [{ id: 'ses_a' }, { id: 'ses_bad' }, { id: 'ses_c' }] }],
      deleteNotOk: ['ses_bad'],
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result).toEqual({ listed: 3, deleted: 2, failed: ['ses_bad'], truncated: false })
    expect(deleteCalls).toHaveLength(3)
  })

  it('keeps going when one delete throws', async () => {
    const { client, deleteCalls } = makeClient({
      pages: [{ data: [{ id: 'ses_a' }, { id: 'ses_boom' }, { id: 'ses_c' }] }],
      deleteErrors: { ses_boom: new Error('connection reset') },
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result).toEqual({ listed: 3, deleted: 2, failed: ['ses_boom'], truncated: false })
    expect(deleteCalls).toHaveLength(3)
  })

  it('stops on a repeating cursor instead of walking the same page forever', async () => {
    const { client, listCalls } = makeClient({
      cursorFor: () => 'always-the-same',
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    // Without the guard this would run until maxPages, reporting progress.
    expect(listCalls).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('reports the page cap as incomplete rather than as a finished purge', async () => {
    const { client, listCalls } = makeClient({
      cursorFor: (index) => `page-${index + 1}`,
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY, { maxPages: 3 })

    expect(listCalls).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('does nothing at all without a directory to scope the delete to', async () => {
    const { client, listCalls, deleteCalls } = makeClient({ pages: [{ data: [{ id: 'ses_a' }] }] })

    const result = await purgeSessionsForDirectory(client, '')

    expect(result).toEqual({ listed: 0, deleted: 0, failed: [], truncated: false })
    expect(listCalls).toHaveLength(0)
    expect(deleteCalls).toHaveLength(0)
  })

  it('skips entries that carry no usable session id', async () => {
    const { client, deleteCalls } = makeClient({
      pages: [{ data: [{ id: '' }, { id: 42 }, {}, null, { id: 'ses_real' }] }],
    })

    const result = await purgeSessionsForDirectory(client, DIRECTORY)

    expect(result).toMatchObject({ listed: 1, deleted: 1 })
    expect(deleteCalls.map((call) => call.path)).toEqual(['/session/ses_real'])
  })

  it('escapes the session id into the delete path', async () => {
    const { client, deleteCalls } = makeClient({ pages: [{ data: [{ id: 'ses/../escape' }] }] })

    await purgeSessionsForDirectory(client, DIRECTORY)

    expect(deleteCalls[0]?.path).toBe('/session/ses%2F..%2Fescape')
  })
})
