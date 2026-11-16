import { describe, it, expect } from 'vitest'
import { FetchError } from '@opencode-manager/shared'
import type { ProviderAuthFailure } from '@opencode-manager/shared/api/v1'
import { mapOAuthError } from './oauthErrors'

/**
 * Every reason the layer can report, written out here rather than imported
 * from the layer's own list: a list that grew a reason without growing a
 * message would be a reason the person is shown the wrong words for.
 */
const REASONS: ProviderAuthFailure[] = [
  'invalid_request',
  'bad_request',
  'authorization_missing',
  'code_missing',
  'callback_failed',
  'validation_failed',
]

function failure(reason: ProviderAuthFailure, detail?: string): FetchError {
  return new FetchError(
    'The provider refused the authorization',
    400,
    'bad_request',
    undefined,
    { details: detail === undefined ? { reason } : { reason, detail } },
  )
}

describe('mapOAuthError', () => {
  it('maps every reason to a distinct specific message', () => {
    const messages = REASONS.map((reason) => mapOAuthError(failure(reason), 'authorize'))
    for (const message of messages) {
      expect(message).not.toBe('The provider refused the authorization')
      expect(message).not.toBe('Failed to initiate OAuth authorization')
    }
    expect(new Set(messages).size).toBe(REASONS.length)
  })

  it('appends the detail when there is one', () => {
    const err = failure('validation_failed', 'must start with sk- — field: apiKey')
    expect(mapOAuthError(err, 'callback')).toContain('must start with sk- — field: apiKey')
  })

  it('falls back to the raw message for failures with no reason', () => {
    const err = new FetchError('Upstream unavailable', 502, 'SOMETHING_ELSE')
    expect(mapOAuthError(err, 'authorize')).toBe('Upstream unavailable')
  })

  it('falls back to the phase default for non-Error values', () => {
    expect(mapOAuthError('nope', 'authorize')).toBe('Failed to initiate OAuth authorization')
    expect(mapOAuthError(undefined, 'callback')).toBe('Failed to complete OAuth callback')
  })
})
