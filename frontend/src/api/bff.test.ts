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

describe('BffClient 问一个会话', () => {
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

  const urlOf = (call = 0) => new URL(String(fetchMock.mock.calls[call]![0]))

  it('问一个会话的时候不说它在哪个目录', async () => {
    answer({ session: { id: 'ses_1' } })

    await createBffClient('').getSession('ses_1')

    expect(urlOf().pathname).toBe('/api/bff/sessions/ses_1')
    expect(urlOf().searchParams.has('directories')).toBe(false)
  })

  it('台账不认得的时候，调用者自己的目录是退路', async () => {
    answer({ session: { id: 'ses_1' } })

    await createBffClient('').getSession('ses_1', ['/w/a'])

    expect(urlOf().searchParams.getAll('directories')).toEqual(['/w/a'])
  })

  it('新建会话的时候要说是哪个目录', async () => {
    answer({ session: { id: 'ses_1' } })

    await createBffClient('').createSession({ title: 'One', directory: '/w/a' })

    expect(urlOf().pathname).toBe('/api/bff/sessions')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'One', directory: '/w/a' }),
      }),
    )
  })

  it('改名问的是这一层', async () => {
    answer({ session: { id: 'ses_1', title: 'Two' } })

    await createBffClient('').renameSession('ses_1', 'Two')

    expect(urlOf().pathname).toBe('/api/bff/sessions/ses_1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Two' }) }),
    )
  })

  it('删除问的是这一层', async () => {
    answer({ deleted: true, id: 'ses_1' })

    const answerBody = await createBffClient('').deleteSession('ses_1')

    expect(urlOf().pathname).toBe('/api/bff/sessions/ses_1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(answerBody).toEqual({ deleted: true, id: 'ses_1' })
  })

  it('中止问的是这一层', async () => {
    answer({ accepted: true })

    await createBffClient('').abortSession('ses_1')

    expect(urlOf().pathname).toBe('/api/bff/sessions/ses_1/abort')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('这一层说的话，客户端要能读出来', async () => {
    // The layer answers in the versioned API's envelope, where the error is
    // an object with a code and a message in it. A client that only
    // understood the older one would show "[object Object]".
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { code: 'forbidden', message: 'A working directory that is not yours was named' },
      }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
    )

    await expect(createBffClient('').deleteSession('ses_1')).rejects.toMatchObject({
      message: 'A working directory that is not yours was named',
      statusCode: 403,
      code: 'forbidden',
    })
  })
})
