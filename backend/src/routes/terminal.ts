import { Hono } from 'hono'
import type { Context } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import { ENV } from '@opencode-manager/shared/config/env'
import { requireAdmin, isAdmin } from '../auth/middleware'
import type { Session } from '../auth'
import { TerminalError, type TerminalActor, type TerminalErrorCode, type TerminalManager, type TerminalSessionSummary } from '../services/terminal/manager'
import type { TerminalSession } from '../services/terminal/session'
import { encodeSSEFrame } from '../utils/sse-frame'
import { getTrustedClientIp } from '../utils/client-ip'
import { logger } from '../utils/logger'
import { getErrorMessage } from '../utils/error-utils'
import { swallow } from '../utils/swallow'

const HEARTBEAT_INTERVAL_MS = 20_000
const MAX_INPUT_LENGTH = 64 * 1024

const createSessionSchema = z.object({
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(300).optional(),
  cwd: z.string().min(1).max(4096).optional(),
})

const inputSchema = z.object({
  data: z.string().max(MAX_INPUT_LENGTH),
})

const resizeSchema = z.object({
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300),
})

const ERROR_STATUS: Record<TerminalErrorCode, 403 | 404 | 429 | 503> = {
  TERMINAL_DISABLED: 503,
  TERMINAL_UNAVAILABLE: 503,
  TERMINAL_SANDBOX_UNAVAILABLE: 503,
  TOO_MANY_SESSIONS: 429,
  SESSION_NOT_FOUND: 404,
  FORBIDDEN: 403,
}

type TerminalContext = Context<{
  Variables: {
    session: Session['session']
    user: Session['user']
  }
}>

function errorResponse(c: TerminalContext, error: TerminalError) {
  // `code` as well as `error`, because that is the field the rest of the
  // frontend keys on when it wants to say something specific instead of
  // "request failed". With only `error` set, `FetchError.code` is undefined and
  // the raw enum ends up printed in the terminal.
  return c.json({ error: error.code, code: error.code }, ERROR_STATUS[error.code])
}

function actorOf(c: TerminalContext): TerminalActor {
  const user = c.get('user')
  return {
    id: user?.id ?? 'unknown',
    email: user?.email ?? 'unknown',
    username: user?.username ?? null,
    role: user?.role === 'admin' ? 'admin' : 'user',
    ipAddress: getTrustedClientIp(c.req.raw.headers),
    userAgent: c.req.header('user-agent') ?? null,
  }
}

function summarize(session: TerminalSession): TerminalSessionSummary {
  const { cols, rows } = session.dimensions
  const { totalBytes } = session.stats
  const exit = session.exit
  return {
    id: session.id,
    userId: session.userId,
    userEmail: session.userEmail,
    shell: session.shell,
    cwd: session.cwd,
    cols,
    rows,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    exited: session.isExited,
    exitCode: exit.code,
    closeReason: exit.reason,
    totalBytes,
  }
}

function handleError(c: TerminalContext, error: unknown) {
  if (error instanceof z.ZodError) {
    return c.json({ error: 'Invalid request', details: error.issues }, 400)
  }
  if (error instanceof TerminalError) {
    return errorResponse(c, error)
  }
  logger.error('Terminal route error', error)
  return c.json({ error: getErrorMessage(error) }, 500)
}

export function createTerminalRoutes(manager: TerminalManager) {
  const app = new Hono<{
    Variables: {
      session: Session['session']
      user: Session['user']
    }
  }>()

  // Registered before the admin gate, on purpose, and with a deliberately
  // smaller payload for everyone else.
  //
  // This endpoint is how the interface answers "may this person open a
  // terminal?", so guarding it with the same rule it reports meant that a
  // non-admin got a 401 instead of an answer - and the terminal simply did not
  // appear, with no reason given. Hono runs handlers in registration order, so
  // this has to be declared above the gate below or the gate still catches it.
  // `cwd` and `shell` are the admin's working directory and interpreter, which
  // say more about the host than a non-admin needs to know, so those two are
  // trimmed rather than served as-is.
  app.get('/config', (c) => {
    const config = manager.getConfig()
    if (isAdmin(c.get('user'))) return c.json(config)
    return c.json({
      enabled: config.enabled,
      available: config.available,
      sandboxAvailable: config.sandboxAvailable,
      adminsOnly: config.adminsOnly,
    })
  })

  if (ENV.TERMINAL.ADMINS_ONLY) {
    app.use('/*', requireAdmin)
  }

  app.get('/sessions', (c) => {
    return c.json({ sessions: manager.list(actorOf(c)) })
  })

  app.post('/sessions', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const input = createSessionSchema.parse(body ?? {})
      const session = manager.create(actorOf(c), input)
      return c.json({ session: summarize(session) }, 201)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/sessions/:id', (c) => {
    try {
      const session = manager.get(c.req.param('id'), actorOf(c))
      return c.json({ session: summarize(session) })
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.get('/sessions/:id/stream', (c) => {
    let session: TerminalSession
    try {
      session = manager.get(c.req.param('id'), actorOf(c))
    } catch (error) {
      return handleError(c, error)
    }

    const parsedFrom = Number.parseInt(c.req.query('from') ?? '0', 10)
    const startSeq = Number.isFinite(parsedFrom) && parsedFrom > 0 ? parsedFrom : 0
    const sessionId = session.id

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache, no-store, no-transform')
    c.header('Connection', 'keep-alive')
    c.header('X-Accel-Buffering', 'no')

    return stream(c, async (writer) => {
      let chain: Promise<unknown> = Promise.resolve()
      let done = false
      let resolveDone: () => void = () => {}
      const finished = new Promise<void>((resolve) => { resolveDone = resolve })

      const send = (event: string, data: unknown) => {
        chain = chain
          .then(() => writer.write(encodeSSEFrame(event, JSON.stringify(data))))
          .catch(swallow)
      }

      const heartbeat = setInterval(() => {
        send('heartbeat', { timestamp: Date.now() })
      }, HEARTBEAT_INTERVAL_MS)

      const finish = () => {
        if (done) return
        done = true
        clearInterval(heartbeat)
        resolveDone()
      }

      send('ready', { session: summarize(session), from: startSeq })

      const unsubscribe = session.attach(
        {
          onOutput: (chunk) => send('output', chunk),
          onExit: (exit) => {
            send('exit', exit)
            chain = chain.then(() => finish())
          },
        },
        startSeq,
      )

      writer.onAbort(() => {
        unsubscribe()
        finish()
      })

      await finished
      await chain
      unsubscribe()
      logger.debug(`Terminal stream for ${sessionId} ended`)
    })
  })

  app.post('/sessions/:id/input', async (c) => {
    try {
      const session = manager.get(c.req.param('id'), actorOf(c))
      const input = inputSchema.parse(await c.req.json())
      session.write(input.data)
      return c.body(null, 204)
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.post('/sessions/:id/resize', async (c) => {
    try {
      const session = manager.get(c.req.param('id'), actorOf(c))
      const input = resizeSchema.parse(await c.req.json())
      session.resize(input.cols, input.rows)
      return c.json({ success: true })
    } catch (error) {
      return handleError(c, error)
    }
  })

  app.delete('/sessions/:id', (c) => {
    try {
      manager.close(c.req.param('id'), actorOf(c))
      return c.json({ success: true })
    } catch (error) {
      return handleError(c, error)
    }
  })

  return app
}
