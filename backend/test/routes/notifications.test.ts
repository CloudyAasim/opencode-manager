import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createNotificationRoutes } from '../../src/routes/notifications'
import type { NotificationService } from '../../src/services/notification'

interface NotificationServiceStub {
  getVapidPublicKey: ReturnType<typeof vi.fn>
  saveSubscription: ReturnType<typeof vi.fn>
  removeSubscription: ReturnType<typeof vi.fn>
  getSubscriptions: ReturnType<typeof vi.fn>
  removeSubscriptionById: ReturnType<typeof vi.fn>
  isConfigured: ReturnType<typeof vi.fn>
  sendTestNotification: ReturnType<typeof vi.fn>
}

describe('Notification Routes', () => {
  let service: NotificationServiceStub
  let app: ReturnType<typeof createNotificationRoutes>

  /**
   * The routes act as whoever the session says they are. These tests used to
   * assert the opposite - that `?userId=` chooses the account - which is how
   * the hole survived a green suite: the tests were not missing it, they were
   * holding it in place.
   */
  const SESSION_USER_ID = 'session-user-1'

  beforeEach(() => {
    vi.clearAllMocks()
    service = {
      getVapidPublicKey: vi.fn(),
      saveSubscription: vi.fn(),
      removeSubscription: vi.fn(),
      getSubscriptions: vi.fn(),
      removeSubscriptionById: vi.fn(),
      isConfigured: vi.fn(),
      sendTestNotification: vi.fn(),
    }
    const routes = createNotificationRoutes(service as unknown as NotificationService)
    const withSession = new Hono<{ Variables: { user: { id: string } } }>()
      .use('*', async (c, next) => {
        c.set('user', { id: SESSION_USER_ID })
        await next()
      })
      .route('/', routes)
    app = withSession as unknown as ReturnType<typeof createNotificationRoutes>
  })

  describe('GET /vapid-public-key', () => {
    it('returns the public key when configured', async () => {
      service.getVapidPublicKey.mockReturnValue('public-key')

      const res = await app.fetch(new Request('http://localhost/vapid-public-key'))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ publicKey: 'public-key' })
    })

    it('returns 503 when push notifications are not configured', async () => {
      service.getVapidPublicKey.mockReturnValue(null)

      const res = await app.fetch(new Request('http://localhost/vapid-public-key'))

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: 'Push notifications are not configured' })
    })
  })

  describe('POST /subscribe', () => {
    it('saves a subscription under the session user', async () => {
      const subscription = {
        id: 1,
        userId: SESSION_USER_ID,
        endpoint: 'https://push.example.com/abc',
        p256dh: 'p256dh-key',
        auth: 'auth-key',
        deviceName: 'Phone',
        createdAt: 1,
        lastUsedAt: null,
      }
      service.saveSubscription.mockReturnValue(subscription)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
          deviceName: 'Phone',
        }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ subscription })
      expect(service.saveSubscription).toHaveBeenCalledWith(
        SESSION_USER_ID,
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key',
        'Phone',
      )
    })

    it('ignores ?userId= and saves under the session user', async () => {
      const subscription = { id: 2 }
      service.saveSubscription.mockReturnValue(subscription)

      const res = await app.fetch(new Request('http://localhost/subscribe?userId=user-9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/abc',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ subscription })
      expect(service.saveSubscription).toHaveBeenCalledWith(
        SESSION_USER_ID,
        'https://push.example.com/abc',
        'p256dh-key',
        'auth-key',
        undefined,
      )
    })

    it('returns 400 for invalid subscription data', async () => {
      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url', keys: {} }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error).toBe('Invalid subscription data')
      expect(service.saveSubscription).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /subscribe', () => {
    it('removes a subscription under the session user', async () => {
      service.removeSubscription.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/abc' }),
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(service.removeSubscription).toHaveBeenCalledWith('https://push.example.com/abc', SESSION_USER_ID)
    })

    it('returns 400 for an invalid endpoint', async () => {
      const res = await app.fetch(new Request('http://localhost/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'not-a-url' }),
      }))

      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error).toBe('Valid endpoint URL is required')
      expect(service.removeSubscription).not.toHaveBeenCalled()
    })
  })

  describe('GET /subscriptions', () => {
    it('lists the session user subscriptions regardless of ?userId=', async () => {
      const subscriptions = [{ id: 1 }, { id: 2 }]
      service.getSubscriptions.mockReturnValue(subscriptions)

      const res = await app.fetch(new Request('http://localhost/subscriptions?userId=user-9'))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ subscriptions })
      expect(service.getSubscriptions).toHaveBeenCalledWith(SESSION_USER_ID)
    })
  })

  describe('DELETE /subscriptions/:id', () => {
    it('removes a subscription by numeric id under the session user', async () => {
      service.removeSubscriptionById.mockReturnValue(true)

      const res = await app.fetch(new Request('http://localhost/subscriptions/12?userId=user-9', {
        method: 'DELETE',
      }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true })
      expect(service.removeSubscriptionById).toHaveBeenCalledWith(12, SESSION_USER_ID)
    })

    it('returns 400 for a non-numeric id', async () => {
      const res = await app.fetch(new Request('http://localhost/subscriptions/abc', {
        method: 'DELETE',
      }))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'Invalid subscription ID' })
      expect(service.removeSubscriptionById).not.toHaveBeenCalled()
    })
  })

  describe('POST /test', () => {
    it('returns 503 when push notifications are not configured', async () => {
      service.isConfigured.mockReturnValue(false)

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(503)
      await expect(res.json()).resolves.toEqual({ error: 'Push notifications are not configured' })
      expect(service.getSubscriptions).not.toHaveBeenCalled()
    })

    it('returns 404 when the user has no subscriptions', async () => {
      service.isConfigured.mockReturnValue(true)
      service.getSubscriptions.mockReturnValue([])

      const res = await app.fetch(new Request('http://localhost/test', { method: 'POST' }))

      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'No push subscriptions registered' })
      expect(service.sendTestNotification).not.toHaveBeenCalled()
    })

    it('sends the test notification to the session user devices', async () => {
      service.isConfigured.mockReturnValue(true)
      service.getSubscriptions.mockReturnValue([{ id: 1 }, { id: 2 }])
      service.sendTestNotification.mockResolvedValue(undefined)

      const res = await app.fetch(new Request('http://localhost/test?userId=user-9', { method: 'POST' }))

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ success: true, devicesNotified: 2 })
      expect(service.sendTestNotification).toHaveBeenCalledWith(SESSION_USER_ID)
    })
  })
})
