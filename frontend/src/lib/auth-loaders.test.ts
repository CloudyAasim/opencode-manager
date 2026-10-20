import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  protectedLoader,
  openCodeSettingsLoader,
  terminalLoader,
} from './auth-loaders'
import { rememberUser, forgetUser } from './session-store'
import { getSession, type AuthUser } from './auth-client'

vi.mock('./auth-client', () => ({
  getSession: vi.fn(),
}))

const mockedGetSession = vi.mocked(getSession)

const admin = { id: 'u1', name: 'Admin', role: 'admin' } as unknown as AuthUser
const tenant = { id: 'u2', name: 'Tenant', role: 'user' } as unknown as AuthUser

const locationOf = (result: unknown): string | null => {
  if (result instanceof Response) return result.headers.get('Location')
  return null
}

beforeEach(() => {
  mockedGetSession.mockReset()
  forgetUser()
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ enabled: true, adminsOnly: false }),
  }) as unknown as typeof fetch
})

/**
 * A page switch used to wait for the server to answer "is this person
 * signed in?" before the new page was allowed to render. On a link with a
 * second of latency, that second was spent looking at the page you had
 * just left.
 *
 * The loaders now read the answer that is already known, so the switch is
 * immediate. These tests are what hold that in place: a loader that goes
 * back to the server for the session turns them red.
 */
describe('route loaders', () => {
  it('does not ask the server for the session when it is already known', async () => {
    rememberUser(tenant)

    const result = await protectedLoader()

    expect(mockedGetSession).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('sends a person without a session to the login page', async () => {
    rememberUser(null)

    const result = await protectedLoader()

    expect(mockedGetSession).not.toHaveBeenCalled()
    expect(locationOf(result)).toBe('/login')
  })

  it('asks the server only when the session is not known yet', async () => {
    mockedGetSession.mockResolvedValue({ data: { user: tenant } } as never)

    const result = await protectedLoader()

    expect(mockedGetSession).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
  })

  it('sends a tenant away from the OpenCode settings page', async () => {
    rememberUser(tenant)

    const result = await openCodeSettingsLoader()

    expect(mockedGetSession).not.toHaveBeenCalled()
    expect(locationOf(result)).toBe('/settings')
  })

  it('lets an administrator into the OpenCode settings page', async () => {
    rememberUser(admin)

    const result = await openCodeSettingsLoader()

    expect(locationOf(result)).toBeNull()
  })

  it('lets an administrator into the terminal without asking the server', async () => {
    rememberUser(admin)

    const result = await terminalLoader()

    expect(mockedGetSession).not.toHaveBeenCalled()
    expect(locationOf(result)).toBeNull()
  })

  it('asks the terminal route about its own configuration, but not about the session', async () => {
    rememberUser(tenant)

    const result = await terminalLoader()

    expect(mockedGetSession).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalled()
    expect(locationOf(result)).toBeNull()
  })
})
