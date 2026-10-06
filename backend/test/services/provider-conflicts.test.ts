import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  acknowledgeProviderConflict,
  clearProviderConflictAcknowledgement,
  fingerprintProviderEntry,
  forgetProviderConflictAcksForMissingDeclarations,
  listProviderConflicts,
  withAcknowledgements,
} from '../../src/services/provider-conflicts'
import { readOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const readMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/opencode-config-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/opencode-config-file')>()
  return { ...actual, readOpenCodeConfigFile: readMock, writeOpenCodeConfigFile: actual.writeOpenCodeConfigFile }
})

describe('provider conflicts', () => {
  let db: Database

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    readMock.mockResolvedValue({ content: { provider: {} } })
  })

  afterEach(() => {
    db.close()
  })

  function globals(provider: Record<string, unknown>): void {
    readMock.mockResolvedValue({ content: { provider } })
  }

  describe('finding them', () => {
    it('reports an id the tenant and the administrator both declared', async () => {
      globals({ acme: { options: { baseURL: 'https://global.test' } } })

      const conflicts = await listProviderConflicts('alice', {
        acme: { options: { baseURL: 'https://alice.test' } },
        mine: { name: 'Only mine' },
      })

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]?.providerId).toBe('acme')
      expect(conflicts[0]?.globalEntry).toMatchObject({ options: { baseURL: 'https://global.test' } })
      expect(conflicts[0]?.userEntry).toMatchObject({ options: { baseURL: 'https://alice.test' } })
    })

    it('reports nothing when the ids do not overlap', async () => {
      globals({ other: { name: 'Other' } })

      expect(await listProviderConflicts('alice', { mine: { name: 'Mine' } })).toEqual([])
    })

    it('reports nothing when there is no global config at all', async () => {
      readMock.mockResolvedValue(null)

      expect(await listProviderConflicts('alice', { mine: { name: 'Mine' } })).toEqual([])
    })

    it('sorts by id so the list does not reshuffle between reloads', async () => {
      globals({ zeta: {}, alpha: {}, mid: {} })

      const conflicts = await listProviderConflicts('alice', { zeta: {}, alpha: {}, mid: {} })

      expect(conflicts.map((c) => c.providerId)).toEqual(['alpha', 'mid', 'zeta'])
    })

    it('treats a global entry that is not an object as a conflict rather than skipping it', async () => {
      globals({ acme: 'nonsense' })

      const conflicts = await listProviderConflicts('alice', { acme: { name: 'Mine' } })

      expect(conflicts.map((c) => c.providerId)).toEqual(['acme'])
    })
  })

  describe('acknowledging them', () => {
    const globalEntry = { options: { baseURL: 'https://global.test' } }

    it('is not acknowledged until the tenant says so', async () => {
      globals({ acme: globalEntry })
      const conflicts = await listProviderConflicts('alice', { acme: { name: 'Mine' } })

      expect(withAcknowledgements(db, 'alice', conflicts)[0]?.acknowledged).toBe(false)

      acknowledgeProviderConflict(db, 'alice', 'acme', globalEntry)

      const after = await listProviderConflicts('alice', { acme: { name: 'Mine' } })
      expect(withAcknowledgements(db, 'alice', after)[0]?.acknowledged).toBe(true)
    })

    it('comes back as unacknowledged when the administrator changes that id', async () => {
      globals({ acme: globalEntry })
      acknowledgeProviderConflict(db, 'alice', 'acme', globalEntry)
      expect(withAcknowledgements(db, 'alice', await listProviderConflicts('alice', { acme: {} }))[0]?.acknowledged)
        .toBe(true)

      // Same id, different endpoint. The tenant agreed to a specific
      // definition; this is a new one and they have not seen it.
      globals({ acme: { options: { baseURL: 'https://somewhere-else.test' } } })

      const after = await listProviderConflicts('alice', { acme: {} })
      expect(withAcknowledgements(db, 'alice', after)[0]?.acknowledged).toBe(false)
    })

    it('still acknowledges when the global entry is put back exactly as it was', async () => {
      globals({ acme: globalEntry })
      acknowledgeProviderConflict(db, 'alice', 'acme', globalEntry)
      globals({ acme: { options: { baseURL: 'https://global.test' } } })

      const after = await listProviderConflicts('alice', { acme: {} })
      expect(withAcknowledgements(db, 'alice', after)[0]?.acknowledged).toBe(true)
    })

    it('keeps one tenant acknowledgement out of another tenant\'s', async () => {
      globals({ acme: globalEntry })
      acknowledgeProviderConflict(db, 'alice', 'acme', globalEntry)

      const forBob = await listProviderConflicts('bob', { acme: {} })

      expect(withAcknowledgements(db, 'bob', forBob)[0]?.acknowledged).toBe(false)
    })

    it('replaces rather than duplicating when the same tenant answers twice', async () => {
      globals({ acme: globalEntry })
      acknowledgeProviderConflict(db, 'alice', 'acme', globalEntry)
      acknowledgeProviderConflict(db, 'alice', 'acme', { options: { baseURL: 'https://second.test' } })

      const row = db.prepare('SELECT COUNT(*) as count FROM provider_conflict_ack').get() as { count: number }
      expect(row.count).toBe(1)
    })

    it('can be withdrawn, and a withdrawn conflict is reported again', async () => {
      globals({ acme: globalEntry })
      acknowledgeProviderConflict(db, 'alice', 'acme', globalEntry)
      clearProviderConflictAcknowledgement(db, 'alice', 'acme')

      const after = await listProviderConflicts('alice', { acme: {} })
      expect(withAcknowledgements(db, 'alice', after)[0]?.acknowledged).toBe(false)
    })
  })

  describe('forgetting them', () => {
    it('drops acknowledgements for ids the tenant no longer declares', async () => {
      acknowledgeProviderConflict(db, 'alice', 'gone', { a: 1 })
      acknowledgeProviderConflict(db, 'alice', 'kept', { a: 2 })

      forgetProviderConflictAcksForMissingDeclarations(db, 'alice', ['kept'])

      const rows = db.prepare('SELECT provider_id FROM provider_conflict_ack WHERE username = ?').all('alice') as Array<{ provider_id: string }>
      expect(rows.map((r) => r.provider_id)).toEqual(['kept'])
    })

    it('leaves other tenants alone', () => {
      acknowledgeProviderConflict(db, 'alice', 'acme', { a: 1 })
      acknowledgeProviderConflict(db, 'bob', 'acme', { a: 1 })

      forgetProviderConflictAcksForMissingDeclarations(db, 'alice', [])

      const rows = db.prepare('SELECT username FROM provider_conflict_ack').all() as Array<{ username: string }>
      expect(rows.map((r) => r.username)).toEqual(['bob'])
    })
  })

  describe('fingerprintProviderEntry', () => {
    it('is stable for the same entry and different for a changed one', () => {
      expect(fingerprintProviderEntry({ a: 1 })).toBe(fingerprintProviderEntry({ a: 1 }))
      expect(fingerprintProviderEntry({ a: 1 })).not.toBe(fingerprintProviderEntry({ a: 2 }))
    })

    it('does not depend on key order', () => {
      expect(fingerprintProviderEntry({ a: 1, b: 2 })).toBe(fingerprintProviderEntry({ b: 2, a: 1 }))
    })

    it('does not depend on key order inside an array element', () => {
      // A provider's `variants` is a list of objects. Canonicalising only the
      // top level and the objects that are values of keys would leave this one
      // order-sensitive, and a rewritten config reorders it silently.
      expect(fingerprintProviderEntry({ variants: [{ x: 1, y: 2 }] }))
        .toBe(fingerprintProviderEntry({ variants: [{ y: 2, x: 1 }] }))
      expect(fingerprintProviderEntry({ variants: [{ x: 1 }] }))
        .not.toBe(fingerprintProviderEntry({ variants: [{ x: 2 }] }))
    })

    it('respects array order, which is not a presentation detail', () => {
      expect(fingerprintProviderEntry({ list: [1, 2] }))
        .not.toBe(fingerprintProviderEntry({ list: [2, 1] }))
    })

    it('treats a missing entry as a value of its own', () => {
      expect(fingerprintProviderEntry(null)).toBe(fingerprintProviderEntry(undefined))
      expect(fingerprintProviderEntry(null)).not.toBe(fingerprintProviderEntry({}))
    })
  })
})
