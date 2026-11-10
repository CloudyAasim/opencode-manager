import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBffClient } from './bff'

describe('BffClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const answer = (body: unknown) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }),
    )

  it('asks the layer for every directory in one request', async () => {
    answer({ sessions: [], cursors: {} })

    await createBffClient('').listSessions(['/w/a', '/w/b'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.pathname).toBe('/api/bff/sessions')
    expect(url.searchParams.getAll('directories')).toEqual(['/w/a', '/w/b'])
  })

  it('asks for a number of sessions per directory', async () => {
    answer({ sessions: [], cursors: {} })

    await createBffClient('').listSessions(['/w/a'], { limit: 25 })

    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('sends the search word it was given', async () => {
    answer({ sessions: [], cursors: {} })

    await createBffClient('').listSessions(['/w/a'], { search: 'deploy' })

    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.searchParams.get('search')).toBe('deploy')
  })

  it('carries the cursors of the next round', async () => {
    answer({ sessions: [], cursors: {} })

    await createBffClient('').listSessions(['/w/a'], { cursors: { '/w/a': 'cursor_next' } })

    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(JSON.parse(url.searchParams.get('cursors')!)).toEqual({ '/w/a': 'cursor_next' })
  })

  it('does not send cursors when there are none', async () => {
    answer({ sessions: [], cursors: {} })

    await createBffClient('').listSessions(['/w/a'])

    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.searchParams.has('cursors')).toBe(false)
  })

  it('hands back the sessions and the cursors it was given', async () => {
    answer({
      sessions: [{ id: 'ses_1', title: 'One', updatedAt: 10 }],
      cursors: { '/w/a': 'cursor_next' },
    })

    const page = await createBffClient('').listSessions(['/w/a'])

    expect(page.sessions).toHaveLength(1)
    expect(page.sessions[0].id).toBe('ses_1')
    expect(page.cursors).toEqual({ '/w/a': 'cursor_next' })
  })
})
