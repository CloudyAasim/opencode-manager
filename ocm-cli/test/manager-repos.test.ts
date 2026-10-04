import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchRepos, unauthorizedMessage } from '../src/manager-repos.js'

/**
 * The manager stopped accepting the shared plugin token on its own, so every
 * install that paired before the change fails on the first call it makes. The
 * only thing standing between that and a support ticket is what the message
 * says, and these cases exist so "manager responded 401 Unauthorized" cannot
 * come back unnoticed.
 */
describe('fetchRepos', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const respond = (response: Response) => {
    globalThis.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch
  }

  it('returns the workspaces the manager listed', async () => {
    respond(new Response(JSON.stringify({ workspaces: [{ repoId: 7, name: 'app' }] }), { status: 200 }))

    const repos = await fetchRepos('https://manager.test', 'tok')

    expect(repos).toHaveLength(1)
    expect(repos[0]?.repoId).toBe(7)
  })

  it('sends the stored token as a bearer credential', async () => {
    respond(new Response(JSON.stringify({ workspaces: [] }), { status: 200 }))

    await fetchRepos('https://manager.test', 'my-token')

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('https://manager.test/api/internal/opencode-workspaces')
    expect((call[1] as RequestInit).headers).toEqual({ Authorization: 'Bearer my-token' })
  })

  it('names the fix when the stored token is refused', async () => {
    respond(new Response('{}', { status: 401, statusText: 'Unauthorized' }))

    const error = await fetchRepos('https://manager.test', 'stale').catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    // The two things a person might be holding, and the one to change.
    expect(message).toContain('per user')
    expect(message).toContain('Settings')
    expect(message).toContain('ocm login')
  })

  it('keeps the status and status text for failures that are not 401', async () => {
    respond(new Response('{}', { status: 502, statusText: 'Bad Gateway' }))

    const error = await fetchRepos('https://manager.test', 'tok').catch((e: Error) => e)

    expect((error as Error).message).toBe('manager responded 502 Bad Gateway')
  })

  it('builds a message that names the manager it came from', () => {
    expect(unauthorizedMessage('https://other.test')).toContain('https://other.test')
  })
})
