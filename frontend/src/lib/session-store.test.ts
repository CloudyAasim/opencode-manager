import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sharedUser,
  knownUser,
  isSessionKnown,
  rememberUser,
  forgetUser,
} from './session-store'
import { getSession, type AuthUser } from './auth-client'

vi.mock('./auth-client', () => ({
  getSession: vi.fn(),
}))

const mockedGetSession = vi.mocked(getSession)

const user = { id: 'u1', name: 'Somebody' } as unknown as AuthUser

beforeEach(() => {
  mockedGetSession.mockReset()
  forgetUser()
})

describe('the shared session', () => {
  it('asks the server once, and only when it does not know the answer yet', async () => {
    mockedGetSession.mockResolvedValue({ data: { user } } as never)

    expect(isSessionKnown()).toBe(false)

    const first = await sharedUser()

    expect(mockedGetSession).toHaveBeenCalledTimes(1)
    expect(first).toEqual(user)
    expect(isSessionKnown()).toBe(true)
  })

  it('does not ask the server again once the answer is known', async () => {
    mockedGetSession.mockResolvedValue({ data: { user } } as never)
    await sharedUser()

    const second = await sharedUser()
    const third = await sharedUser()

    expect(mockedGetSession).toHaveBeenCalledTimes(1)
    expect(second).toEqual(user)
    expect(third).toEqual(user)
  })

  it('shares one request between callers that arrive at the same time', async () => {
    let resolve!: (value: unknown) => void
    mockedGetSession.mockReturnValue(new Promise((r) => { resolve = r }) as never)

    const waiting = Promise.all([sharedUser(), sharedUser(), sharedUser()])
    resolve({ data: { user } })
    const answers = await waiting

    expect(mockedGetSession).toHaveBeenCalledTimes(1)
    expect(answers.every((answer) => answer === user)).toBe(true)
  })

  it('treats "there is no session" as an answer, not as a reason to ask again', async () => {
    mockedGetSession.mockResolvedValue({ data: { user: null } } as never)

    expect(await sharedUser()).toBeNull()
    expect(await sharedUser()).toBeNull()

    expect(mockedGetSession).toHaveBeenCalledTimes(1)
    expect(isSessionKnown()).toBe(true)
    expect(knownUser()).toBeNull()
  })

  it('forgets the session on purpose, and then asks again', async () => {
    mockedGetSession.mockResolvedValue({ data: { user } } as never)
    await sharedUser()
    expect(mockedGetSession).toHaveBeenCalledTimes(1)

    forgetUser()
    expect(isSessionKnown()).toBe(false)

    await sharedUser()
    expect(mockedGetSession).toHaveBeenCalledTimes(2)
  })

  it('reports a session it was told about without asking for it', async () => {
    rememberUser(user)

    expect(isSessionKnown()).toBe(true)
    expect(knownUser()).toEqual(user)
    expect(await sharedUser()).toEqual(user)
    expect(mockedGetSession).not.toHaveBeenCalled()
  })
})
