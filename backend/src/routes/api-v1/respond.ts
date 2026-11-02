import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { z } from 'zod'
import { logger } from '../../utils/logger'
import type { ApiErrorCode } from '@opencode-manager/shared/api/v1'
import {
  AgentNotFoundError,
  ProviderProtocolError,
  ProviderUnavailableError,
  ProviderUpstreamError,
  SessionNotFoundError,
} from '../../providers/contract'

export function ok<T>(c: Context, schema: z.ZodType<T>, payload: unknown): Response {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    logger.error('A v1 response did not match its own contract', parsed.error.issues)
    return c.json(
      { error: { code: 'internal_error', message: 'The response did not match the API contract' } },
      500,
    )
  }
  return c.json(parsed.data)
}

export function fail(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): Response {
  return c.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    status,
  )
}

export function failFromError(c: Context, error: unknown): Response {
  if (error instanceof AgentNotFoundError) {
    return fail(c, 404, 'agent_not_found', error.message)
  }
  if (error instanceof SessionNotFoundError) {
    return fail(c, 404, 'not_found', error.message)
  }
  if (error instanceof ProviderUnavailableError) {
    return fail(c, 503, 'agent_unavailable', error.message)
  }
  if (error instanceof ProviderProtocolError) {
    return fail(c, 502, 'upstream_error', error.message)
  }
  if (error instanceof ProviderUpstreamError) {
    return fail(c, 502, 'upstream_error', error.message)
  }
  logger.error('Unexpected failure while serving the v1 API', error)
  return fail(c, 500, 'internal_error', 'Something went wrong')
}

/**
 * Every handler goes through here. The web framework catches an exception at
 * the handler it happened in and hands it to the server's own error handler,
 * which knows nothing about this API's envelope - so the catching has to
 * happen here, where the envelope is known.
 */
export function handle(c: Context, run: () => Promise<Response>): Promise<Response> {
  return run().catch((error) => failFromError(c, error))
}
