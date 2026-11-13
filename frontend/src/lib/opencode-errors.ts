import { FetchError } from '@opencode-manager/shared/types/errors'
import type { MessageError } from '@opencode-manager/shared/api/v1'

/**
 * A failure, in the words the app shows.
 *
 * The conversation's errors are the versioned API's - one truth about what
 * went wrong - and this turns one of those into the two things the screen
 * needs: a heading and a sentence.
 */
export interface ParsedError {
  title: string
  message: string
  isRetryable: boolean
  statusCode?: number
  providerID?: string
}

export function parseMessageError(error: MessageError | undefined | null): ParsedError | null {
  if (!error) return null

  switch (error.kind) {
    case 'authentication':
      return {
        title: 'Authentication Failed',
        message: error.message || `Authentication failed for provider: ${error.providerId ?? 'the provider'}`,
        isRetryable: false,
        providerID: error.providerId ?? undefined,
      }

    case 'output-length':
      return {
        title: 'Response Too Long',
        message: error.message || 'The model response exceeded the maximum allowed length',
        isRetryable: false,
      }

    case 'aborted':
      return null

    case 'api':
      return {
        title: `API Error${error.statusCode ? ` (${error.statusCode})` : ''}`,
        message: error.message || 'An API error occurred',
        isRetryable: error.isRetryable ?? false,
        statusCode: error.statusCode ?? undefined,
      }

    default:
      return {
        title: 'Error',
        message: error.message || 'An unknown error occurred',
        isRetryable: error.isRetryable ?? true,
      }
  }
}

export function isGatewayTimeout(error: unknown): boolean {
  return error instanceof FetchError && error.statusCode === 524
}

export function parseNetworkError(error: unknown): ParsedError {
  if (error instanceof Error) {
    if (error instanceof FetchError) {
      if (error.statusCode === 502) {
        return {
          title: 'Server Unavailable',
          message: 'The OpenCode server is not responding. It may need to be restarted.',
          isRetryable: true,
        }
      }

      if (error.statusCode === 524) {
        return {
          title: 'Request Timeout',
          message: 'The request took too long to complete. Please try again.',
          isRetryable: true,
        }
      }
    }

    const message = error.message.toLowerCase()

    if (message.includes('timeout') || message.includes('etimedout')) {
      return {
        title: 'Request Timeout',
        message: 'The request took too long to complete. Please try again.',
        isRetryable: true,
      }
    }

    if (
      message.includes('failed to fetch') ||
      message.includes('network error') ||
      message.includes('networkerror') ||
      message.includes('fetch failed') ||
      message.includes('econnrefused') ||
      message.includes('econnreset')
    ) {
      return {
        title: 'Connection Failed',
        message: 'Could not connect to the server. Please check your connection.',
        isRetryable: true,
      }
    }

    if (message.includes('502') || message.includes('bad gateway')) {
      return {
        title: 'Server Unavailable',
        message: 'The OpenCode server is not responding. It may need to be restarted.',
        isRetryable: true,
      }
    }

    return {
      title: 'Error',
      message: error.message,
      isRetryable: true,
    }
  }

  return {
    title: 'Error',
    message: 'An unexpected error occurred',
    isRetryable: true,
  }
}

export function getOpenCodeApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof FetchError) {
    let message = error.detail || error.message || fallback

    if (error.validationIssues && error.validationIssues.length > 0) {
      const issues = error.validationIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      message = `Validation failed: ${issues}`
    }

    return message
  }

  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { details?: string; error?: string; validationIssues?: Array<{ path: string; message: string }> } } }).response
    const data = response?.data

    let message = data?.details || data?.error || fallback

    if (data?.validationIssues && data.validationIssues.length > 0) {
      const issues = data.validationIssues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')
      message = `Validation failed: ${issues}`
    }

    return message
  }

  return fallback
}
