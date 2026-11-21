import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import {
  BffConfigurationResponseSchema,
  BffConfigurationSaveResponseSchema,
  BffConfigurationUpdateRequestSchema,
  BffEffectiveConfigurationResponseSchema,
} from '@opencode-manager/shared/api/bff'
import type { Session } from '../../auth'
import { principalFrom, principalIsAdmin } from '../../auth/ownership'
import type { ProviderRegistry } from '../../providers/registry'
import { ResourceNotFoundError } from '../../providers/contract'
import { SettingsService } from '../../services/settings'
import {
  applyConfigurationUpdate,
  ConfigurationConflictError,
  ConfigurationRemovalShadowedError,
  maskConfigurationContent,
  readConfigurationDocument,
} from '../../services/agent-configuration'
import { getTrustedClientIp } from '../../utils/client-ip'
import { ValidationError } from '../../utils/errors'
import { fail, handle, ok } from '../api-v1/respond'
import { agentIdOf } from '../api-v1/params'

type ConfigurationContext = Context<{
  Variables: {
    session: Session['session']
    user: Session['user']
  }
}>

/**
 * The configuration.
 *
 * The client used to ask the manager's own door for this, and that door
 * answered with the document as it is written down - which is also where the
 * credentials of every model provider on the host live. Four keys went into
 * the browser that way, and the browser had no reason to hold any of them.
 *
 * So the document is asked for here, and it travels with holes in it: every
 * credential is the word that stands for one, and the path it was at is kept,
 * because the server puts its own value back where its own value was. The
 * client may read the configuration and write the configuration; the
 * credentials are not part of that bargain.
 *
 * The configuration is the whole host's, and everybody's conversations read
 * it - so a change here is not the caller's own business but everyone's, and
 * it is the administrator's to make.
 */
export function createBffConfigurationRoutes(
  registry: ProviderRegistry,
  database: Database,
) {
  // The settings the server keeps. The configuration is one of them, and a
  // change to it has to be remembered as the last known good one - so that a
  // configuration that turns out to be broken can be put back the way it was.
  const settingsService = new SettingsService(database)

  const app = new Hono<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>()

  app.get('/', (c) =>
    handle(c, async () => {
      const denied = denyUnlessAdministrator(c)
      if (denied) return denied

      const configuration = await readConfigurationDocument()
      if (!configuration) {
        throw new ResourceNotFoundError('configuration')
      }

      return ok(c, BffConfigurationResponseSchema, { configuration })
    }),
  )

  /**
   * What the agent is running with.
   *
   * The agent's own answer, and not the file: the running configuration has
   * the environment expanded and the projects merged into it, and the keys are
   * in there too - expanded, but still keys.
   */
  app.get('/effective', (c) =>
    handle(c, async () => {
      const denied = denyUnlessAdministrator(c)
      if (denied) return denied

      const provider = registry.resolve(agentIdOf(c))
      const effective = await provider.getEffectiveConfiguration({})

      return ok(c, BffEffectiveConfigurationResponseSchema, {
        configuration: maskConfigurationContent(effective),
      })
    }),
  )

  /**
   * Writing the configuration.
   *
   * What lands on disk is the client's document with the server's own
   * credentials in it: this layer manages the configuration, and the
   * credentials are not the client's to change.
   */
  app.put('/', (c) =>
    handle(c, async () => {
      const denied = denyUnlessAdministrator(c)
      if (denied) return denied

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return fail(c, 400, 'bad_request', 'The body is not JSON')
      }

      const parsed = BffConfigurationUpdateRequestSchema.safeParse(body)
      if (!parsed.success) {
        return fail(c, 400, 'bad_request', 'That is not a configuration', parsed.error.issues)
      }

      try {
        const { configuration, restartRequired, overriddenCredentials } = await applyConfigurationUpdate({
          content: parsed.data.content,
          source: parsed.data.source,
          expectedRevision: parsed.data.expectedRevision,
          settingsService,
          db: database,
          actor: actorFrom(c),
        })

        // The places where the client wrote a credential of its own and the
        // server's value went back there instead are named in the answer. A
        // write that quietly does not happen is worse than one that is
        // refused - the person believes they changed something, and they did
        // not.
        return ok(c, BffConfigurationSaveResponseSchema, {
          configuration,
          restartRequired,
          overriddenCredentials,
        })
      } catch (error) {
        if (error instanceof ValidationError) {
          return fail(c, 400, 'bad_request', error.message)
        }
        // Somebody else wrote first, or a removal is defined in another file.
        // Both are conflicts: the request was fine, the world moved.
        if (error instanceof ConfigurationConflictError) {
          return fail(c, 409, 'conflict', error.message, {
            expectedRevision: error.expectedRevision,
            actualRevision: error.actualRevision,
          })
        }
        if (error instanceof ConfigurationRemovalShadowedError) {
          return fail(c, 409, 'conflict', error.message, {
            paths: error.paths,
            sources: error.sources,
          })
        }
        throw error
      }
    }),
  )

  return app
}

/**
 * The configuration is everybody's, so it is the administrator's to read and
 * to write.
 */
function denyUnlessAdministrator(c: ConfigurationContext): Response | null {
  const principal = principalFrom(c.get('user'))
  if (principalIsAdmin(principal)) return null
  return fail(c, 403, 'forbidden', 'Only an administrator may read or change the configuration')
}

/**
 * Who is making this call, for the row the change leaves behind.
 *
 * Read defensively: the user on the context is not always a full account, and
 * a row that says "undefined" about a person is worse than a row that admits
 * it has none.
 */
function actorFrom(c: ConfigurationContext): {
  userId: string | null
  userEmail: string | null
  ipAddress: string | null
  userAgent: string | null
} {
  const user = c.get('user') as { id?: string; email?: string | null } | undefined
  return {
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    ipAddress: getTrustedClientIp(c.req.raw.headers),
    userAgent: c.req.header('user-agent') ?? null,
  }
}
