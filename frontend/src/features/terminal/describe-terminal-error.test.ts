import { describe, it, expect } from 'vitest'
import { FetchError } from '@/api/fetchWrapper'
import { describeTerminalError } from './describe-terminal-error'

const t = (key: string) => `translated:${key}`

describe('describeTerminalError', () => {
  it('says the sandbox could not be built, not that a request failed', () => {
    const error = new FetchError('TERMINAL_SANDBOX_UNAVAILABLE', 503, 'TERMINAL_SANDBOX_UNAVAILABLE')

    // This is the one that reached a real screen as `[TERMINAL_SANDBOX_UNAVAILABLE]`
    // in the middle of a terminal. Accurate, and something the reader could do
    // nothing with.
    expect(describeTerminalError(error, t)).toBe('translated:terminal.sandboxUnavailableDescription')
  })

  it('still recognises the code when only the message carries it', () => {
    // The route used to send `{ error }` with no `code`, so `FetchError.code`
    // was undefined. Older servers and any future regression land here, and
    // the reader should not see the enum for it.
    const error = new FetchError('TERMINAL_SANDBOX_UNAVAILABLE', 503)

    expect(describeTerminalError(error, t)).toBe('translated:terminal.sandboxUnavailableDescription')
  })

  it('distinguishes the three ordinary refusals', () => {
    expect(describeTerminalError(new FetchError('x', 503, 'TERMINAL_DISABLED'), t))
      .toBe('translated:terminal.unavailableDescription')
    expect(describeTerminalError(new FetchError('x', 503, 'TERMINAL_UNAVAILABLE'), t))
      .toBe('translated:terminal.unavailableDescription')
    expect(describeTerminalError(new FetchError('x', 429, 'TOO_MANY_SESSIONS'), t))
      .toBe('translated:terminal.tooManySessionsDescription')
    expect(describeTerminalError(new FetchError('x', 403, 'FORBIDDEN'), t))
      .toBe('translated:terminal.adminsOnlyDescription')
  })

  it('shows an unrecognised code raw rather than hiding it', () => {
    // A new refusal should be visible until it has a translation. Collapsing it
    // into a generic message would make the next one of these unfindable.
    expect(describeTerminalError(new FetchError('x', 500, 'SOMETHING_NEW'), t)).toBe('x')
  })

  it('copes with something that is not an error at all', () => {
    expect(describeTerminalError(undefined, t)).toBe('error')
  })
})
