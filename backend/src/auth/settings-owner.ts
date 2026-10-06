import type { Context } from 'hono'

/**
 * Who a settings read or write belongs to.
 *
 * Settings are keyed by user id, and the TTS and STT sections hold API keys.
 * The TTS and STT routes used to take that id from `?userId=`, which made it a
 * selector rather than a filter - the same hole already closed for
 * `/api/internal/settings` - and, worse, split the two halves of one setting
 * apart: writes went to the session user, reads went to whichever tenant the
 * client named. Enabling TTS in the panel could therefore never be heard, and
 * the model list could never be discovered, because the panel was asking
 * about a different user than the one it was writing to.
 *
 * The owner is the session. There is no query-string override, and no
 * 'default' tenant for a request that arrives with one.
 */
export function settingsOwnerId(c: Context | unknown): string {
  const ctx = c as { get?: (key: string) => { id?: string } | undefined }
  return ctx.get?.('user')?.id ?? 'default'
}
