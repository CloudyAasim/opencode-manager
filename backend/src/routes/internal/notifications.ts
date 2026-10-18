import { Hono } from 'hono'
import { AssistantNotificationRequestSchema } from '@opencode-manager/shared/schemas'
import type { NotificationService } from '../../services/notification'
import { TokenBucketRateLimiter } from '../../utils/rate-limit'
import { internalUserOf } from '../../auth/internal-token-middleware'

export function createInternalNotificationRoutes(notificationService: NotificationService) {
  const app = new Hono()
  const limiter = new TokenBucketRateLimiter({ capacity: 10, refillPerMs: 60_000 })

  app.post('/send', async (c) => {
    if (!notificationService.isConfigured()) {
      return c.json({ error: 'Push notifications are not configured (missing VAPID env)' }, 503)
    }

    const token = (c.req.header('authorization') ?? '').slice('Bearer '.length)
    const limit = limiter.tryConsume(token || 'anon')
    if (!limit.allowed) {
      c.header('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)))
      return c.json({ error: 'Rate limit exceeded' }, 429)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = AssistantNotificationRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.issues }, 400)
    }

    const userId = internalUserOf(c)?.id
    if (!userId) {
      // `?userId=` was not a filter, it was a selector: any agent holding a
      // token could name another tenant and have the server's VAPID key push a
      // real notification to all of that account's devices. The web route was
      // fixed for this; the internal one kept the copy, and it is the more
      // reachable of the two because it is the one the assistant plugin calls.
      //
      // No `?? 'default'` fallback either - a fallback here is the same
      // selector with a different spelling.
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const payload = {
      title: parsed.data.title,
      body: parsed.data.body,
      tag: parsed.data.tag ?? `assistant-${Date.now()}`,
      timestamp: Date.now(),
      data: {
        eventType: 'assistant.message',
        url: parsed.data.url ?? '/',
        priority: parsed.data.priority,
      },
    }

    const stats = await notificationService.sendToUser(userId, payload)
    return c.json({
      delivered: stats.delivered,
      expired: stats.expired,
      failed: stats.failed,
      noSubscriptions: stats.total === 0,
    })
  })

  return app
}
