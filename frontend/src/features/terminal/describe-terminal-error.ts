import { FetchError } from '@/api/fetchWrapper'

/**
 * The server refuses in named ways, and each one means something different to
 * the person looking at it. Printing the enum was accurate and useless - it
 * told them nothing they could act on, and it reads like a crash rather than a
 * decision. `TERMINAL_SANDBOX_UNAVAILABLE` in particular is the server saying
 * "I could not confine your shell, so I am not giving you one", which is a
 * safety decision and deserves to be presented as one.
 *
 * Anything unrecognised falls through to the raw message on purpose: a code
 * with no translation should be visible until somebody writes it, rather than
 * silently collapsing into a generic failure.
 */
export function describeTerminalError(error: unknown, t: (key: string) => string): string {
  const code = error instanceof FetchError ? error.code ?? error.message : undefined
  switch (code) {
    case 'TERMINAL_SANDBOX_UNAVAILABLE':
      return t('terminal.sandboxUnavailableDescription')
    case 'TERMINAL_DISABLED':
    case 'TERMINAL_UNAVAILABLE':
      return t('terminal.unavailableDescription')
    case 'TOO_MANY_SESSIONS':
      return t('terminal.tooManySessionsDescription')
    case 'FORBIDDEN':
      return t('terminal.adminsOnlyDescription')
    default:
      return error instanceof Error ? error.message : 'error'
  }
}
