import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: {
    isSessionBeingViewed: vi.fn(() => false),
    isSubagentSession: vi.fn(() => false),
  },
}))

// `ownedBy` / `anyOwner` are pure scope constructors with no database behind
// them, so the real implementations are the honest ones to hand back. Leaving
// them out does not fail loudly - the modules under test receive `undefined`
// and every scoped lookup quietly degrades to "no owner". Deliberately not
// spreading `importActual`: a mock that leaks every real export stops
// reporting the ones it forgot.
vi.mock('../../src/db/queries', async () => {
  const { anyOwner } = await vi.importActual<typeof import('../../src/db/queries')>('../../src/db/queries')

  return {
    getRepoBySourcePath: vi.fn(() => null),
    getRepoByLocalPath: vi.fn(() => null),
    getRepoName: vi.fn(() => 'repo-name'),
    listRepos: vi.fn(() => []),
    anyOwner,
  }
})

vi.mock('../../src/services/project-id-resolver', () => ({
  resolveProjectId: vi.fn(async () => null),
}))

import webpush from 'web-push'
import { logger } from '../../src/utils/logger'
import { sseAggregator } from '../../src/services/sse-aggregator'
import {
  anyOwner,
  getRepoBySourcePath,
  getRepoByLocalPath,
  listRepos,
} from '../../src/db/queries'
import { resolveProjectId } from '../../src/services/project-id-resolver'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createTestDb } from '../helpers/assistant-workspace'
import type { Repo } from '../../src/types/repo'

const VAPID = {
  publicKey: 'public-key-1',
  privateKey: 'private-key-1',
  subject: 'mailto:ops@example.com',
}

const REPO = { id: 7, fullPath: '/repos/my-repo', cloneStatus: 'ready' } as unknown as Repo
const SEND_OK = { statusCode: 201, body: '', headers: {} }

const allEvents = {
  permissionAsked: true,
  questionAsked: true,
  sessionError: true,
  sessionIdle: true,
}

let db: Database
let service: NotificationService

function enableNotifications(userId: string, overrides: Record<string, unknown> = {}): void {
  new SettingsService(db).updateSettings(
    {
      notifications: {
        enabled: true,
        events: { ...allEvents },
        ...overrides,
      },
    },
    userId,
  )
}

function subscriptionRow(endpoint: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as
    | Record<string, unknown>
    | undefined
}

function sentPayloads(): Array<Record<string, unknown>> {
  return vi
    .mocked(webpush.sendNotification)
    .mock.calls.map((call) => JSON.parse(call[1] as string) as Record<string, unknown>)
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createTestDb()
  service = new NotificationService(db)
  vi.mocked(webpush.sendNotification).mockResolvedValue(SEND_OK)
  vi.mocked(sseAggregator.isSessionBeingViewed).mockReturnValue(false)
  vi.mocked(sseAggregator.isSubagentSession).mockReturnValue(false)
  vi.mocked(getRepoBySourcePath).mockReturnValue(null)
  vi.mocked(getRepoByLocalPath).mockReturnValue(null)
  vi.mocked(listRepos).mockReturnValue([])
  vi.mocked(resolveProjectId).mockResolvedValue(null)
})

afterEach(() => {
  db.close()
})

describe('NotificationService vapid configuration', () => {
  it('reports no public key and unconfigured before configureVapid runs', () => {
    expect(service.getVapidPublicKey()).toBeNull()
    expect(service.isConfigured()).toBe(false)
  })

  it('exposes the public key and reports configured after configureVapid', () => {
    service.configureVapid(VAPID)
    expect(service.getVapidPublicKey()).toBe('public-key-1')
    expect(service.isConfigured()).toBe(true)
  })

  it('registers the vapid details with web-push using the configured subject and keys', () => {
    service.configureVapid(VAPID)
    expect(webpush.setVapidDetails).toHaveBeenCalledTimes(1)
    expect(webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:ops@example.com',
      'public-key-1',
      'private-key-1',
    )
  })

  it('replaces the stored public key when configured again', () => {
    service.configureVapid(VAPID)
    service.configureVapid({ ...VAPID, publicKey: 'public-key-2' })
    expect(service.getVapidPublicKey()).toBe('public-key-2')
    expect(webpush.setVapidDetails).toHaveBeenCalledTimes(2)
  })

  it('keeps configuration independent per service instance', () => {
    service.configureVapid(VAPID)
    const other = new NotificationService(db)
    expect(other.getVapidPublicKey()).toBeNull()
    expect(other.isConfigured()).toBe(false)
  })
})

describe('NotificationService push_subscriptions schema', () => {
  it('creates the push_subscriptions table on first use', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'push_subscriptions'")
      .get()
    expect(row).toBeDefined()
  })

  it('creates the endpoint and user indexes', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
    ).map((r) => r.name)
    expect(names).toContain('idx_push_sub_user')
    expect(names).toContain('idx_push_sub_endpoint')
  })

  it('preserves existing subscriptions when a second service is built on the same database', () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    const second = new NotificationService(db)
    expect(second.getSubscriptions('user-1')).toHaveLength(1)
  })
})

describe('NotificationService saveSubscription', () => {
  it('stores a subscription and returns the persisted record', () => {
    const record = service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1', 'Laptop')
    expect(record.userId).toBe('user-1')
    expect(record.endpoint).toBe('https://push.example/one')
    expect(record.p256dh).toBe('k1')
    expect(record.auth).toBe('a1')
    expect(record.deviceName).toBe('Laptop')
    expect(record.id).toBeGreaterThan(0)
    expect(record.createdAt).toBeGreaterThan(0)
    expect(record.lastUsedAt).toBe(record.createdAt)
  })

  it('stores a null device name when none is provided', () => {
    const record = service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    expect(record.deviceName).toBeNull()
  })

  it('updates the existing row instead of inserting a duplicate for the same endpoint', () => {
    const first = service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1', 'Laptop')
    const second = service.saveSubscription('user-1', 'https://push.example/one', 'k2', 'a2', 'Phone')
    expect(second.id).toBe(first.id)
    expect(second.p256dh).toBe('k2')
    expect(second.auth).toBe('a2')
    expect(second.deviceName).toBe('Phone')
    expect(service.getSubscriptions('user-1')).toHaveLength(1)
  })

  it('reassigns ownership when the same endpoint is saved by another user', () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-2', 'https://push.example/one', 'k1', 'a1')
    expect(service.getSubscriptions('user-1')).toHaveLength(0)
    expect(service.getSubscriptions('user-2')).toHaveLength(1)
  })

  it('keeps the original created_at when an endpoint is re-saved', async () => {
    const first = service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.lastUsedAt).toBeGreaterThanOrEqual(first.createdAt)
  })

  it('stores subscriptions for different users independently', () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-2', 'https://push.example/two', 'k2', 'a2')
    expect(service.getSubscriptions('user-1')).toHaveLength(1)
    expect(service.getSubscriptions('user-2')).toHaveLength(1)
  })
})

describe('NotificationService getSubscriptions', () => {
  it('returns only the subscriptions owned by the requested user', () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-2', 'https://push.example/two', 'k2', 'a2')
    const records = service.getSubscriptions('user-1')
    expect(records).toHaveLength(1)
    expect(records[0]?.endpoint).toBe('https://push.example/one')
  })

  it('orders subscriptions by creation time, newest first', async () => {
    service.saveSubscription('user-1', 'https://push.example/old', 'k1', 'a1')
    await new Promise((resolve) => setTimeout(resolve, 5))
    service.saveSubscription('user-1', 'https://push.example/new', 'k2', 'a2')
    expect(service.getSubscriptions('user-1').map((r) => r.endpoint)).toEqual([
      'https://push.example/new',
      'https://push.example/old',
    ])
  })

  it('returns an empty list for a user without subscriptions', () => {
    expect(service.getSubscriptions('nobody')).toEqual([])
  })
})

describe('NotificationService getAllUserIds', () => {
  it('returns each distinct user id once', () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-1', 'https://push.example/two', 'k2', 'a2')
    service.saveSubscription('user-2', 'https://push.example/three', 'k3', 'a3')
    expect(service.getAllUserIds().sort()).toEqual(['user-1', 'user-2'])
  })

  it('returns an empty list when nothing is subscribed', () => {
    expect(service.getAllUserIds()).toEqual([])
  })
})

describe('NotificationService removeSubscription', () => {
  beforeEach(() => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
  })

  it('removes a subscription owned by the given user', () => {
    expect(service.removeSubscription('https://push.example/one', 'user-1')).toBe(true)
    expect(subscriptionRow('https://push.example/one')).toBeUndefined()
  })

  it('keeps the subscription when the user does not match', () => {
    expect(service.removeSubscription('https://push.example/one', 'user-2')).toBe(false)
    expect(subscriptionRow('https://push.example/one')).toBeDefined()
  })

  it('removes a subscription when no user id is supplied', () => {
    expect(service.removeSubscription('https://push.example/one')).toBe(true)
    expect(subscriptionRow('https://push.example/one')).toBeUndefined()
  })

  it('reports false for an unknown endpoint', () => {
    expect(service.removeSubscription('https://push.example/missing')).toBe(false)
  })

  it('reports false for an unknown endpoint even when a user id is supplied', () => {
    expect(service.removeSubscription('https://push.example/missing', 'user-1')).toBe(false)
  })

  it('leaves other subscriptions untouched', () => {
    service.saveSubscription('user-1', 'https://push.example/two', 'k2', 'a2')
    service.removeSubscription('https://push.example/one')
    expect(service.getSubscriptions('user-1').map((r) => r.endpoint)).toEqual([
      'https://push.example/two',
    ])
  })
})

describe('NotificationService removeSubscriptionById', () => {
  beforeEach(() => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
  })

  it('removes a subscription by id for the owning user', () => {
    const record = service.getSubscriptions('user-1')[0]!
    expect(service.removeSubscriptionById(record.id, 'user-1')).toBe(true)
    expect(service.getSubscriptions('user-1')).toEqual([])
  })

  it('keeps the subscription when the user does not own the id', () => {
    const record = service.getSubscriptions('user-1')[0]!
    expect(service.removeSubscriptionById(record.id, 'user-2')).toBe(false)
    expect(service.getSubscriptions('user-1')).toHaveLength(1)
  })

  it('reports false for an unknown id', () => {
    expect(service.removeSubscriptionById(9999, 'user-1')).toBe(false)
  })

  it('removes only the targeted subscription when several exist', () => {
    service.saveSubscription('user-1', 'https://push.example/two', 'k2', 'a2')
    const target = service
      .getSubscriptions('user-1')
      .find((row) => row.endpoint === 'https://push.example/one')!
    expect(service.removeSubscriptionById(target.id, 'user-1')).toBe(true)
    expect(subscriptionRow('https://push.example/one')).toBeUndefined()
    expect(subscriptionRow('https://push.example/two')).toBeDefined()
  })
})

describe('NotificationService sendToUser', () => {
  it('reports zero totals when the user has no subscriptions', async () => {
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 0, expired: 0, failed: 0, total: 0 })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('delivers to every subscription and refreshes last_used_at', async () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-1', 'https://push.example/two', 'k2', 'a2')
    const before = service.getSubscriptions('user-1').map((r) => r.lastUsedAt)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 2, expired: 0, failed: 0, total: 2 })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    expect(service.getSubscriptions('user-1').map((r) => r.lastUsedAt)).toEqual(
      before.map(() => expect.any(Number)),
    )
  })

  it('sends the stored endpoint and keys with the serialized payload', async () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/one', keys: { p256dh: 'k1', auth: 'a1' } },
      JSON.stringify({ title: 't', body: 'b' }),
    )
  })

  it('removes subscriptions that fail with 404 and counts them as expired', async () => {
    service.saveSubscription('user-1', 'https://push.example/gone', 'k1', 'a1')
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 404 }),
    )
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 0, expired: 1, failed: 0, total: 1 })
    expect(subscriptionRow('https://push.example/gone')).toBeUndefined()
  })

  it('removes subscriptions that fail with 410 and counts them as expired', async () => {
    service.saveSubscription('user-1', 'https://push.example/gone', 'k1', 'a1')
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error('expired'), { statusCode: 410 }),
    )
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 0, expired: 1, failed: 0, total: 1 })
    expect(service.getSubscriptions('user-1')).toEqual([])
  })

  it('counts other delivery failures as failed and keeps the subscription', async () => {
    service.saveSubscription('user-1', 'https://push.example/broken', 'k1', 'a1')
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error('server exploded'), { statusCode: 500 }),
    )
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 0, expired: 0, failed: 1, total: 1 })
    expect(subscriptionRow('https://push.example/broken')).toBeDefined()
  })

  it('logs non-expiry delivery failures', async () => {
    service.saveSubscription('user-1', 'https://push.example/broken', 'k1', 'a1')
    const failure = new Error('server exploded')
    vi.mocked(webpush.sendNotification).mockRejectedValue(failure)
    await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('https://push.example/brok'),
      failure,
    )
  })

  it('does not log expiry failures as errors', async () => {
    service.saveSubscription('user-1', 'https://push.example/gone', 'k1', 'a1')
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    )
    await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('counts expired and failed separately when both occur in one batch', async () => {
    service.saveSubscription('user-1', 'https://push.example/gone', 'k1', 'a1')
    service.saveSubscription('user-1', 'https://push.example/broken', 'k2', 'a2')
    vi.mocked(webpush.sendNotification).mockImplementation(async (sub) => {
      throw Object.assign(new Error('push rejected'), {
        statusCode: sub.endpoint === 'https://push.example/gone' ? 410 : 500,
      })
    })
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 0, expired: 1, failed: 1, total: 2 })
    expect(subscriptionRow('https://push.example/gone')).toBeUndefined()
    expect(subscriptionRow('https://push.example/broken')).toBeDefined()
  })

  it('delivers to healthy subscriptions even when another one fails', async () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-1', 'https://push.example/broken', 'k2', 'a2')
    vi.mocked(webpush.sendNotification)
      .mockResolvedValueOnce(SEND_OK)
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 1, expired: 0, failed: 1, total: 2 })
  })

  it('treats a rejection without a status code as a plain failure', async () => {
    service.saveSubscription('user-1', 'https://push.example/broken', 'k1', 'a1')
    vi.mocked(webpush.sendNotification).mockRejectedValue(new Error('network down'))
    const result = await service.sendToUser('user-1', { title: 't', body: 'b' })
    expect(result).toEqual({ delivered: 0, expired: 0, failed: 1, total: 1 })
    expect(service.getSubscriptions('user-1')).toHaveLength(1)
  })
})

describe('NotificationService sendTestNotification', () => {
  it('sends the test payload to every subscription of the user', async () => {
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    service.saveSubscription('user-1', 'https://push.example/two', 'k2', 'a2')
    await service.sendTestNotification('user-1')
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    expect(sentPayloads()[0]).toEqual({
      title: 'Test Notification',
      body: 'Push notifications are working correctly',
      tag: 'test',
      data: { eventType: 'test', url: '/' },
    })
  })

  it('does not notify other users', async () => {
    service.saveSubscription('user-2', 'https://push.example/other', 'k1', 'a1')
    await service.sendTestNotification('user-1')
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
})

describe('NotificationService handleSSEEvent', () => {
  beforeEach(() => {
    service.configureVapid(VAPID)
    service.saveSubscription('user-1', 'https://push.example/one', 'k1', 'a1')
    enableNotifications('user-1')
  })

  it('ignores event types that are not notification events', async () => {
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'session.created',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('ignores events for a session a client is currently viewing', async () => {
    vi.mocked(sseAggregator.isSessionBeingViewed).mockReturnValue(true)
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('ignores events for a subagent session', async () => {
    vi.mocked(sseAggregator.isSubagentSession).mockReturnValue(true)
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'question.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('still notifies for events without a session id', async () => {
    await service.handleSSEEvent('/repos/my-repo', { type: 'session.idle', properties: {} })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('ignores events when vapid is not configured', async () => {
    const unconfigured = new NotificationService(db)
    await unconfigured.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('ignores events when no user has a subscription', async () => {
    db.prepare('DELETE FROM push_subscriptions').run()
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('skips users whose notifications are disabled', async () => {
    new SettingsService(db).updateSettings(
      { notifications: { enabled: false, events: { ...allEvents } } },
      'user-1',
    )
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('skips users who disabled the specific event', async () => {
    new SettingsService(db).updateSettings(
      {
        notifications: {
          enabled: true,
          events: { ...allEvents, permissionAsked: false },
        },
      },
      'user-1',
    )
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('still notifies for other event types when one is disabled', async () => {
    new SettingsService(db).updateSettings(
      {
        notifications: {
          enabled: true,
          events: { ...allEvents, permissionAsked: false },
        },
      },
      'user-1',
    )
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'question.asked',
      properties: { sessionID: 'ses_1' },
    })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('sends a deep link and repo name when the directory resolves to a repo', async () => {
    vi.mocked(getRepoBySourcePath).mockReturnValue(REPO)
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash', metadata: { command: 'ls' } },
    })
    // The only cross-tenant lookup in the codebase, asserted rather than
    // assumed. It is a system job handed an absolute directory with no user
    // attached: the row it finds only decides who gets told, never what they
    // are allowed to do, so scoping it to a user would silently stop owned
    // repositories from resolving at all.
    expect(getRepoBySourcePath).toHaveBeenCalledWith(expect.anything(), '/repos/my-repo', anyOwner())
    const [payload] = sentPayloads()
    expect(payload?.title).toBe('Run Command')
    expect(payload?.tag).toBe('permission.asked-ses_1')
    expect(payload?.data).toMatchObject({
      eventType: 'permission.asked',
      sessionId: 'ses_1',
      directory: '/repos/my-repo',
      repoId: 7,
      repoName: 'repo-name',
      url: '/repos/7/sessions/ses_1',
    })
  })

  it('falls back to the local path lookup when the source path does not match', async () => {
    vi.mocked(getRepoBySourcePath).mockReturnValue(null)
    vi.mocked(getRepoByLocalPath).mockReturnValue(REPO)
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(getRepoByLocalPath).toHaveBeenCalledTimes(1)
    expect(sentPayloads()[0]?.data).toMatchObject({ repoId: 7 })
  })

  it('resolves the repo by project id among ready repos', async () => {
    const other = { id: 9, fullPath: '/repos/other', cloneStatus: 'ready' } as unknown as Repo
    vi.mocked(listRepos).mockReturnValue([other, REPO])
    vi.mocked(resolveProjectId).mockImplementation(async (target: string) => {
      if (target === '/repos/other') return 'project-y'
      return 'project-x'
    })
    await service.handleSSEEvent('/repos/elsewhere', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(sentPayloads()[0]?.data).toMatchObject({ repoId: 7 })
  })

  it('ignores repos that are not ready while matching by project id', async () => {
    const pending = { id: 9, fullPath: '/repos/other', cloneStatus: 'cloning' } as unknown as Repo
    vi.mocked(listRepos).mockReturnValue([pending])
    vi.mocked(resolveProjectId).mockResolvedValue('project-x')
    await service.handleSSEEvent('/repos/elsewhere', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(sentPayloads()[0]?.data).toMatchObject({ url: '/' })
  })

  it('skips a candidate repo whose project id lookup rejects', async () => {
    const other = { id: 9, fullPath: '/repos/other', cloneStatus: 'ready' } as unknown as Repo
    vi.mocked(listRepos).mockReturnValue([other, REPO])
    vi.mocked(resolveProjectId).mockImplementation(async (target: string) => {
      if (target === '/repos/other') throw new Error('git exploded')
      return 'project-x'
    })
    await service.handleSSEEvent('/repos/elsewhere', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(sentPayloads()[0]?.data).toMatchObject({ repoId: 7 })
  })

  it('sends a repo-less notification when no repo can be resolved', async () => {
    await service.handleSSEEvent('/repos/unknown', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(sentPayloads()[0]?.data).toMatchObject({ url: '/' })
    expect(resolveProjectId).toHaveBeenCalledWith('/repos/unknown')
  })

  it('sends a global notification when the directory is empty', async () => {
    await service.handleSSEEvent('', { type: 'session.idle', properties: {} })
    const [payload] = sentPayloads()
    expect(payload?.data).toMatchObject({ url: '/', directory: '' })
    expect(getRepoBySourcePath).not.toHaveBeenCalled()
  })

  it('sends one notification per subscribed user', async () => {
    service.saveSubscription('user-2', 'https://push.example/two', 'k2', 'a2')
    enableNotifications('user-2')
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
  })

  it('notifies only the users who opted in when preferences differ', async () => {
    service.saveSubscription('user-2', 'https://push.example/two', 'k2', 'a2')
    new SettingsService(db).updateSettings(
      { notifications: { enabled: false, events: { ...allEvents } } },
      'user-2',
    )
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('refreshes last_used_at after a delivered event', async () => {
    const before = service.getSubscriptions('user-1')[0]!.lastUsedAt
    await new Promise((resolve) => setTimeout(resolve, 5))
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(service.getSubscriptions('user-1')[0]!.lastUsedAt).toBeGreaterThan(before!)
  })

  it('prunes an expired subscription while handling an event', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    )
    await service.handleSSEEvent('/repos/my-repo', {
      type: 'permission.asked',
      properties: { sessionID: 'ses_1', permission: 'bash' },
    })
    expect(service.getSubscriptions('user-1')).toEqual([])
  })
})
