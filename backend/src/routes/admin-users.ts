import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../auth/middleware'
import type { Session } from '../auth'
import { UserAdminError, type ManagedUser, type UserAdminService, type UserAdminErrorCode } from '../services/user-admin'
import { logger } from '../utils/logger'
import { getErrorMessage } from '../utils/error-utils'

const roleSchema = z.enum(['admin', 'user'])

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  username: z.string().regex(/^[A-Za-z][A-Za-z0-9]{2,31}$/).optional(),
  password: z.string().min(8).max(128),
  role: roleSchema.default('user'),
})

const setRoleSchema = z.object({
  role: roleSchema,
})

const setPasswordSchema = z.object({
  password: z.string().min(8).max(128),
})

const ERROR_STATUS: Record<UserAdminErrorCode, 400 | 404 | 409 | 500> = {
  EMAIL_EXISTS: 409,
  USERNAME_EXISTS: 409,
  INVALID_USERNAME: 400,
  USER_NOT_FOUND: 404,
  LAST_ADMIN: 400,
  SELF_DELETE: 400,
  NO_CREDENTIAL_ACCOUNT: 400,
  CLEANUP_FAILED: 500,
  INTERNAL: 500,
}

function errorResponse(c: Context, error: UserAdminError) {
  return c.json({ error: error.code }, ERROR_STATUS[error.code])
}

export interface AdminUserRouteOptions {
  /**
   * Runs after the delete has been accepted and before anything on disk is
   * removed, so that live shells belonging to this person are closed while
   * their working directory still exists. It is not called when the delete is
   * refused.
   */
  onUserWillBeDeleted?: (userId: string) => void
}

export function createAdminUserRoutes(userAdmin: UserAdminService, options: AdminUserRouteOptions = {}) {
  const app = new Hono<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>()

  app.use('/*', requireAdmin)

  app.get('/', (c) => {
    return c.json({ users: userAdmin.listUsers() satisfies ManagedUser[] })
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const input = createUserSchema.parse(body)
      const created = await userAdmin.createUser(input)
      logger.info(`Admin created user ${created.email} with role ${created.role}`)
      return c.json({ user: created }, 201)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      if (error instanceof UserAdminError) {
        return errorResponse(c, error)
      }
      logger.error('Failed to create user', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.patch('/:id/role', async (c) => {
    try {
      const body = await c.req.json()
      const input = setRoleSchema.parse(body)
      const actingUserId = c.get('user')?.id
      const updated = userAdmin.setRole(c.req.param('id'), input.role, actingUserId)
      logger.info(`Admin changed role for ${updated.email} to ${updated.role}`)
      return c.json({ user: updated })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      if (error instanceof UserAdminError) {
        return errorResponse(c, error)
      }
      logger.error('Failed to update user role', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.post('/:id/password', async (c) => {
    try {
      const body = await c.req.json()
      const input = setPasswordSchema.parse(body)
      await userAdmin.setPassword(c.req.param('id'), input.password)
      logger.info('Admin reset a user password')
      return c.json({ success: true })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.issues }, 400)
      }
      if (error instanceof UserAdminError) {
        return errorResponse(c, error)
      }
      logger.error('Failed to reset user password', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      const actingUserId = c.get('user')?.id
      const id = c.req.param('id')
      await userAdmin.deleteUser(id, actingUserId, options.onUserWillBeDeleted)
      logger.info('Admin deleted a user')
      return c.json({ success: true })
    } catch (error) {
      if (error instanceof UserAdminError) {
        return errorResponse(c, error)
      }
      logger.error('Failed to delete user', error)
      return c.json({ error: getErrorMessage(error) }, 500)
    }
  })

  return app
}
