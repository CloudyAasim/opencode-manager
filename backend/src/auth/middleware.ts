import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { AuthInstance, Session } from './index'
import { logger } from '../utils/logger'

/**
 * How the gate answers when it says no. The rule itself is the same
 * everywhere - one session, or no session - but a versioned API has to
 * answer in its own shape, and a second copy of the rule would be free to
 * disagree with the first one about what a session is.
 */
export interface AuthErrorResponses {
  unauthorized: (c: Context) => Response
  internalError: (c: Context) => Response
}

export function createAuthMiddleware(auth: AuthInstance, responses?: AuthErrorResponses) {
  return createMiddleware<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>(async (c, next) => {
    const cookies = c.req.header('cookie')
    const origin = c.req.header('origin')
    
    logger.debug(`Auth check - Path: ${c.req.path}, Origin: ${origin}, Has cookies: ${!!cookies}`)
    if (cookies) {
      const cookieNames = cookies.split(';').map(c => c.trim().split('=')[0]).join(', ')
      logger.debug(`Cookie names: ${cookieNames}`)
    }
    
    let session
    try {
      session = await auth.api.getSession({
        headers: c.req.raw.headers,
      })
    } catch (error) {
      logger.error('Session lookup failed', { error })
      if (responses) return responses.internalError(c)
      return c.json({ error: 'Internal Server Error' }, 500)
    }

    logger.debug(`Session result: ${session ? 'found' : 'not found'}`)

    if (!session) {
      if (responses) return responses.unauthorized(c)
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('session', session.session as Session['session'])
    c.set('user', session.user as Session['user'])
    await next()
  })
}

export function isAdmin(user: Session['user'] | undefined): boolean {
  return user?.role === 'admin'
}

export const requireAdmin = createMiddleware<{
  Variables: {
    session: Session['session']
    user: Session['user']
  }
}>(async (c, next) => {
  if (!isAdmin(c.get('user'))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await next()
})


