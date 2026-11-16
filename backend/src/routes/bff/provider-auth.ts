import { Hono } from 'hono'
import { z } from 'zod'
import {
  BffAcceptedResponseSchema,
  BffProviderAuthMethodsResponseSchema,
  BffProviderCredentialListResponseSchema,
  BffProviderOAuthAuthorizationResponseSchema,
} from '@opencode-manager/shared/api/bff'
import {
  ProviderOAuthAuthorizeRequestSchema,
  ProviderOAuthCallbackRequestSchema,
} from '@opencode-manager/shared/api/v1'
import type { Session } from '../../auth'
import type { ProviderRegistry } from '../../providers/registry'
import { principalFrom } from '../../auth/ownership'
import { UserProviderService } from '../../services/user-providers'
import { logger } from '../../utils/logger'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'

/**
 * What has to happen once a provider has been logged in to.
 *
 * The layer does not know what that is: the credential is in the hands of the
 * agent, and the agent is kept running by the manager, so the manager is the
 * one that says what has to happen afterwards. The layer only says "it is
 * done".
 */
export type AfterAuthorization = () => Promise<void>

/**
 * How a model gets logged in.
 *
 * Two halves, and they were two halves on the manager's own doors as well:
 *
 * - The ways a provider may be logged in - an API key, or an authorization
 *   that is done somewhere else - are the agent's business. They are asked for
 *   through the contract, so a client is told the ways in this layer's words
 *   whichever agent is behind them.
 *
 * - The credentials themselves are the manager's own: they are written into
 *   the configuration files of the person who typed them, and the manager is
 *   the one that keeps them. They are not the agent's to hand out, and they are
 *   not asked for: the client says which provider and what key, and the
 *   manager writes it down.
 *
 * Both halves are here because the client draws one panel: the ways of
 * logging in and the credentials that are already there belong to the same
 * question, and a client that had to ask two places about one question would
 * be holding two dialects to answer it.
 */
export function createBffProviderAuthRoutes(
  registry: ProviderRegistry,
  afterAuthorization?: AfterAuthorization,
) {
  const app = new Hono<{ Variables: { session: Session['session']; user: Session['user'] } }>()
  const credentials = new UserProviderService()

  /**
   * The person asking.
   *
   * Credentials belong to a person, not to a session: two sessions of the same
   * person share them. A person whose account has no name has nowhere to
   * keep them, and saying so is better than pretending there are none.
   */
  const usernameOf = (c: { get: (key: string) => Session['user'] | undefined }): string | null =>
    principalFrom(c.get('user'))?.username ?? null

  /**
   * The credentials of the person asking.
   */
  app.get('/credentials', (c) =>
    handle(c, async () => {
      const username = usernameOf(c)
      const providers = username ? await credentials.list(username) : []
      return ok(c, BffProviderCredentialListResponseSchema, { credentials: providers })
    }),
  )

  /**
   * Writing a credential down.
   *
   * The key is written into the configuration of every place the person works
   * in, so that whichever repository they open, the provider is there.
   */
  app.post('/credentials/:providerId', (c) =>
    handle(c, async () => {
      const username = usernameOf(c)
      if (!username) {
        return fail(c, 403, 'forbidden', 'This account cannot keep credentials')
      }

      const providerId = c.req.param('providerId')
      const body = await readJson(c)
      const parsed = z.object({ apiKey: z.string().min(1) }).safeParse(body)
      if (!parsed.success) {
        return fail(c, 400, 'bad_request', 'That is not a credential', parsed.error.issues)
      }

      await credentials.set(username, providerId, parsed.data.apiKey)
      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * Taking a credential away.
   */
  app.delete('/credentials/:providerId', (c) =>
    handle(c, async () => {
      const username = usernameOf(c)
      if (!username) {
        return fail(c, 403, 'forbidden', 'This account cannot keep credentials')
      }

      await credentials.delete(username, c.req.param('providerId'))
      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  /**
   * The ways a provider may be logged in.
   */
  app.get('/methods', (c) =>
    handle(c, async () => {
      const provider = registry.resolve(agentIdOf(c))
      const methods = await provider.listProviderAuthMethods({})
      return ok(c, BffProviderAuthMethodsResponseSchema, { methods })
    }),
  )

  /**
   * Starting an authorization.
   */
  app.post('/:providerId/authorize', (c) =>
    handle(c, async () => {
      const providerId = c.req.param('providerId')
      const body = await readJson(c)
      const parsed = ProviderOAuthAuthorizeRequestSchema.safeParse(body)
      if (!parsed.success) {
        return fail(c, 400, 'bad_request', 'That is not an authorization', parsed.error.issues)
      }

      const provider = registry.resolve(agentIdOf(c))
      const authorization = await provider.authorizeProviderAuth(providerId, parsed.data, {})
      return ok(c, BffProviderOAuthAuthorizationResponseSchema, { authorization })
    }),
  )

  /**
   * Finishing an authorization.
   *
   * The provider keeps the authorization, so the provider is told that it is
   * over - and then the agent is told to read its configuration again, because
   * the credential it was just given is not in the configuration it is
   * holding. That last part is the manager's own work: the manager is the one
   * that keeps the agent running.
   */
  app.post('/:providerId/callback', (c) =>
    handle(c, async () => {
      const providerId = c.req.param('providerId')
      const body = await readJson(c)
      const parsed = ProviderOAuthCallbackRequestSchema.safeParse(body)
      if (!parsed.success) {
        return fail(c, 400, 'bad_request', 'That is not an authorization', parsed.error.issues)
      }

      const provider = registry.resolve(agentIdOf(c))
      await provider.completeProviderAuth(providerId, parsed.data, {})

      if (afterAuthorization) {
        try {
          await afterAuthorization()
        } catch (error) {
          // The authorization itself is over - the provider has it. What may
          // have failed is whatever the manager does afterwards, and saying so
          // is better than pretending the whole thing did not happen.
          logger.warn(`Failed to finish what follows the authorization of ${providerId}:`, error)
        }
      }

      return ok(c, BffAcceptedResponseSchema, { accepted: true })
    }),
  )

  return app
}

/**
 * The body, if it is JSON.
 */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
