import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Database } from 'bun:sqlite'
import { z } from 'zod'
import { UserProviderService } from '../services/user-providers'
import {
  acknowledgeProviderConflict,
  clearProviderConflictAcknowledgement,
  listProviderConflicts,
  withAcknowledgements,
} from '../services/provider-conflicts'
import { SetCredentialRequestSchema } from '../../../shared/src/schemas/auth'
import { recordOpenCodeConfigAudit, type OpenCodeConfigAuditActor } from '../services/opencode-config-audit'
import { getTrustedClientIp } from '../utils/client-ip'
import { logger } from '../utils/logger'
import { getAccessScope } from '../auth/access-scope'
import type { OpenCodeClient } from '../services/opencode/client'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import {
  addRecentModel,
  ModelSelectionSchema,
  readOpenCodeModelState,
  removeRecentModel,
  toggleFavoriteModel,
  updateOpenCodeModelState,
} from '../services/opencode-model-state'

const UpdateModelStateSchema = z.object({
  recent: ModelSelectionSchema.optional(),
  favorite: ModelSelectionSchema.optional(),
  removeRecent: ModelSelectionSchema.optional(),
}).strict()

const PROVIDER_ID_PATTERN = /^[a-z0-9-]+$/

/**
 * One provider declaration, and nothing else.
 *
 * The shape is the point. The global endpoint takes a whole merged
 * configuration because an administrator is editing the server's own; this one
 * takes a single provider entry under `provider`, so no request shape can carry
 * `model`, `permission`, `agent`, `mcp` or `plugin` through it - not an
 * oversized one, and not one that simply forgot a field.
 */
const ProviderEntrySchema = z.record(z.string(), z.unknown())

const DeclareProviderSchema = z.object({
  providerId: z.string().min(1).max(100).regex(PROVIDER_ID_PATTERN, 'providerId must be lowercase letters, digits and dashes'),
  entry: ProviderEntrySchema,
})

function actorFrom(c: Context): OpenCodeConfigAuditActor {
  const user = c.get('user' as never) as { id?: string; email?: string | null } | undefined
  return {
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    ipAddress: getTrustedClientIp(c.req.raw.headers),
    userAgent: c.req.header('user-agent') ?? null,
  }
}

/**
 * One row saying a tenant changed their own provider set.
 *
 * `scope` is `user` and `subject` is the tenant, which is the whole difference
 * from a global write in the audit log: reading it back, "who was affected" is
 * one person rather than the server.
 */
function recordProviderWrite(
  db: Database,
  input: {
    actor: OpenCodeConfigAuditActor
    username: string
    providerId: string
    action: 'declare' | 'undeclare'
  },
): void {
  const before = input.action === 'declare' ? [] : [input.providerId]
  const after = input.action === 'declare' ? [input.providerId] : []
  try {
    recordOpenCodeConfigAudit(db, {
      actor: input.actor,
      scope: 'user',
      subject: input.username,
      source: 'per-user opencode.json',
      changedKeys: ['provider'],
      details: { action: input.action, provider: { added: after, removed: before } },
      restartPending: false,
    })
  } catch (error) {
    logger.error('Failed to record provider declaration audit', error)
  }
}

export function createProvidersRoutes(
  _openCodeClient: OpenCodeClient,
  _openCodeSupervisor?: OpenCodeSupervisor,
  db?: Database,
) {
  const app = new Hono()
  const userProviderService = new UserProviderService()
  const currentUsername = () => getAccessScope()?.username ?? null

  /**
   * Whoever is asking, for the audit row.
   *
   * The username is the subject because a tenant's declaration is that
   * tenant's business; the id is kept so a row can still name an account whose
   * username has since been changed.
   */
  function requireTenant(c: Context): { username: string; actor: OpenCodeConfigAuditActor } | null {
    const username = currentUsername()
    if (!username) return null
    return { username, actor: actorFrom(c) }
  }

  app.get('/model-state', async (c) => {
    try {
      const state = await readOpenCodeModelState()
      return c.json(state)
    } catch (error) {
      logger.error('Failed to read OpenCode model state:', error)
      return c.json({ recent: [], favorite: [], variant: {} })
    }
  })

  app.post('/model-state', async (c) => {
    try {
      const body = await c.req.json()
      const validated = UpdateModelStateSchema.parse(body)

      const nextState = await updateOpenCodeModelState((state) => {
        if (validated.favorite) {
          return toggleFavoriteModel(state, validated.favorite)
        }
        if (validated.recent) {
          return addRecentModel(state, validated.recent)
        }
        if (validated.removeRecent) {
          return removeRecentModel(state, validated.removeRecent)
        }
        return state
      })

      return c.json(nextState)
    } catch (error) {
      logger.error('Failed to update OpenCode model state:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update OpenCode model state' }, 500)
    }
  })

  app.get('/credentials', async (c) => {
    try {
      const username = currentUsername()
      const providers = username ? await userProviderService.list(username) : []
      return c.json({ providers })
    } catch (error) {
      logger.error('Failed to list provider credentials:', error)
      return c.json({ error: 'Failed to list provider credentials' }, 500)
    }
  })

  app.get('/:id/credentials/status', async (c) => {
    try {
      const providerId = c.req.param('id')
      const username = currentUsername()
      const hasCredentials = username ? await userProviderService.has(username, providerId) : false
      return c.json({ hasCredentials })
    } catch (error) {
      logger.error('Failed to check credential status:', error)
      return c.json({ error: 'Failed to check credential status' }, 500)
    }
  })

  app.post('/:id/credentials', async (c) => {
    try {
      const username = currentUsername()
      if (!username) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
      const providerId = c.req.param('id')
      const body = await c.req.json()
      const validated = SetCredentialRequestSchema.parse(body)

      await userProviderService.set(username, providerId, validated.apiKey)

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to set provider credentials:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to set provider credentials' }, 500)
    }
  })

  app.delete('/:id/credentials', async (c) => {
    try {
      const username = currentUsername()
      if (!username) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
      const providerId = c.req.param('id')

      await userProviderService.delete(username, providerId)

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete provider credentials:', error)
      return c.json({ error: 'Failed to delete provider credentials' }, 500)
    }
  })

  // ---- the caller's own declarations ----

  app.get('/declarations', async (c) => {
    try {
      const tenant = requireTenant(c)
      if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

      const declarations = await userProviderService.declarations(tenant.username)
      const conflicts = db
        ? withAcknowledgements(db, tenant.username, await listProviderConflicts(tenant.username, declarations))
        : []

      return c.json({ declarations, conflicts })
    } catch (error) {
      logger.error('Failed to list provider declarations:', error)
      return c.json({ error: 'Failed to list provider declarations' }, 500)
    }
  })

  app.put('/declarations', async (c) => {
    try {
      const tenant = requireTenant(c)
      if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

      const body = await c.req.json()
      const validated = DeclareProviderSchema.parse(body)

      await userProviderService.declare(tenant.username, validated.providerId, validated.entry)

      if (db) {
        // Describing the provider again is a fresh decision about the same id.
        // An old "yes, I meant to keep mine" was given about a different
        // version of this declaration and must not carry over to it.
        clearProviderConflictAcknowledgement(db, tenant.username, validated.providerId)
        recordProviderWrite(db, {
          actor: tenant.actor,
          username: tenant.username,
          providerId: validated.providerId,
          action: 'declare',
        })
      }

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to declare provider:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid provider declaration', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to declare provider' }, 500)
    }
  })

  app.delete('/declarations/:id', async (c) => {
    try {
      const tenant = requireTenant(c)
      if (!tenant) return c.json({ error: 'Unauthorized' }, 401)

      const providerId = c.req.param('id')
      if (!PROVIDER_ID_PATTERN.test(providerId)) {
        return c.json({ error: 'Invalid provider id' }, 400)
      }

      await userProviderService.undeclare(tenant.username, providerId)

      if (db) {
        // The conflict only existed because of this declaration, so removing it
        // ends it - and the acknowledgement with it, or the next time this id
        // is declared the prompt would already be answered for a definition
        // nobody has looked at.
        clearProviderConflictAcknowledgement(db, tenant.username, providerId)
        recordProviderWrite(db, {
          actor: tenant.actor,
          username: tenant.username,
          providerId,
          action: 'undeclare',
        })
      }

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to remove provider declaration:', error)
      return c.json({ error: 'Failed to remove provider declaration' }, 500)
    }
  })

  app.post('/declarations/:id/keep-mine', async (c) => {
    try {
      const tenant = requireTenant(c)
      if (!tenant || !db) return c.json({ error: 'Unauthorized' }, 401)

      const providerId = c.req.param('id')
      const declarations = await userProviderService.declarations(tenant.username)
      if (!(providerId in declarations)) {
        return c.json({ error: 'No such declaration' }, 404)
      }

      const conflict = (await listProviderConflicts(tenant.username, declarations))
        .find((entry) => entry.providerId === providerId)

      // Nothing to acknowledge - the administrator has not declared this id.
      // Answering anyway would write a fingerprint of nothing, which would then
      // match a real definition later and silence the prompt before it was
      // ever shown.
      if (!conflict) {
        return c.json({ success: true, acknowledged: false })
      }

      acknowledgeProviderConflict(db, tenant.username, providerId, conflict.globalEntry)
      return c.json({ success: true, acknowledged: true })
    } catch (error) {
      logger.error('Failed to record provider conflict acknowledgement:', error)
      return c.json({ error: 'Failed to record acknowledgement' }, 500)
    }
  })

  return app
}
