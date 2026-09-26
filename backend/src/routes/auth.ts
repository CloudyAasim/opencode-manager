import { Hono } from 'hono'
import type { AuthInstance } from '../auth'
import { Database } from 'bun:sqlite'
import { ENV } from '@opencode-manager/shared/config/env'
import { logger } from '../utils/logger'
import { isEmailAllowed, isSelfSignupAllowed } from '../auth/access-policy'

export function createAuthRoutes(auth: AuthInstance): Hono {
  const app = new Hono()

  app.all('/*', async (c) => {
    const path = c.req.path

    if (path.includes('/sign-up')) {
      if (!isSelfSignupAllowed()) {
        const email = await readSignupEmail(c.req.raw)
        if (!email || !isEmailAllowed(email)) {
          logger.warn('Blocked HTTP sign-up attempt: self-registration disabled', { path })
          return c.json(
            { error: 'SIGN_UP_DISABLED', message: 'Self-registration is disabled. Ask an administrator for an account.' },
            403,
          )
        }
      }
    }

    const response = await auth.handler(c.req.raw)

    const setCookie = response.headers.get('set-cookie')
    if (path.includes('sign-in')) {
      logger.info(`Sign-in response - Status: ${response.status}, Set-Cookie: ${setCookie ? 'present' : 'missing'}`)
      if (setCookie) {
        logger.debug(`Set-Cookie header: ${setCookie.substring(0, 100)}...`)
      }
    }

    return response
  })

  return app
}

async function readSignupEmail(request: Request): Promise<string | null> {
  try {
    const body = (await request.clone().json()) as { email?: unknown }
    return typeof body.email === 'string' ? body.email : null
  } catch {
    return null
  }
}

const isAdminConfigured = (): boolean => {
  return !!(ENV.AUTH.ADMIN_EMAIL && ENV.AUTH.ADMIN_PASSWORD)
}

export function createAuthInfoRoutes(auth: AuthInstance, db: Database) {
  const app = new Hono()

  app.get('/config', async (c) => {
    const enabledProviders: string[] = ['credentials']

    if (ENV.AUTH.GITHUB_CLIENT_ID && ENV.AUTH.GITHUB_CLIENT_SECRET) {
      enabledProviders.push('github')
    }
    if (ENV.AUTH.GOOGLE_CLIENT_ID && ENV.AUTH.GOOGLE_CLIENT_SECRET) {
      enabledProviders.push('google')
    }
    if (ENV.AUTH.DISCORD_CLIENT_ID && ENV.AUTH.DISCORD_CLIENT_SECRET) {
      enabledProviders.push('discord')
    }

    enabledProviders.push('passkey')

    const hasUsers = db.prepare('SELECT COUNT(*) as count FROM "user"').get() as { count: number }
    const adminConfigured = isAdminConfigured()

    return c.json({
      enabledProviders,
      registrationEnabled: isSelfSignupAllowed(),
      isFirstUser: hasUsers.count === 0,
      adminConfigured,
    })
  })

  app.get('/me', async (c) => {
    try {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      })

      if (!session) {
        return c.json({ user: null, session: null })
      }

      return c.json({
        user: session.user,
        session: {
          id: session.session.id,
          expiresAt: session.session.expiresAt,
        },
      })
    } catch {
      return c.json({ user: null, session: null })
    }
  })

  return app
}
