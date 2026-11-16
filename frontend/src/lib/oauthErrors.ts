import { FetchError } from '@opencode-manager/shared/types/errors'
import type { ProviderAuthFailure } from '@opencode-manager/shared/api/v1'

/**
 * What a failure of an authorization says to the person.
 *
 * The reasons are this layer's own words - "the code is missing", "the
 * provider said no" - and not the agent's own names for its failures: a
 * client that was handed those would be holding the agent's vocabulary.
 */
const ERROR_MESSAGES: Record<ProviderAuthFailure, string> = {
  invalid_request: 'The request was invalid. Please check your details and try again.',
  bad_request: 'The provider rejected the request. Please try the OAuth flow again.',
  authorization_missing:
    'No authorization is in progress for this provider. Please start the OAuth flow again.',
  code_missing: 'An authorization code is required. Please paste the code from the provider.',
  callback_failed:
    'The provider rejected the authorization. It may have expired — please try again.',
  validation_failed:
    'Some authentication details were invalid. Please check them and try again.',
}

/**
 * The reason a failure carries, when it carries one.
 *
 * It travels in the details, because the versioned vocabulary of codes is a
 * coarse one: "bad request" alone cannot tell a missing code from a rejected
 * one, and the person would be shown the same words for both.
 */
function reasonOf(err: FetchError): ProviderAuthFailure | null {
  const details = err.details
  if (!details || typeof details !== 'object') return null
  const reason = (details as { reason?: unknown }).reason
  if (typeof reason !== 'string') return null
  return reason in ERROR_MESSAGES ? (reason as ProviderAuthFailure) : null
}

/**
 * What the provider said about the failure, when it said anything.
 */
function detailOf(err: FetchError): string | undefined {
  const details = err.details
  if (!details || typeof details !== 'object') return undefined
  const detail = (details as { detail?: unknown }).detail
  return typeof detail === 'string' && detail ? detail : undefined
}

export function mapOAuthError(err: unknown, context: 'authorize' | 'callback'): string {
  const defaultMessage = context === 'authorize'
    ? 'Failed to initiate OAuth authorization'
    : 'Failed to complete OAuth callback'

  if (!(err instanceof Error)) return defaultMessage

  if (err instanceof FetchError) {
    const reason = reasonOf(err)
    if (reason) {
      const detail = err.detail ?? detailOf(err)
      return detail
        ? `${ERROR_MESSAGES[reason]} (${detail})`
        : ERROR_MESSAGES[reason]
    }
  }

  return err.message || defaultMessage
}
