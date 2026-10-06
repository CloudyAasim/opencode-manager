import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import {
  UNATTRIBUTED_ACTOR,
  diffOpenCodeConfig,
  listOpenCodeConfigAudit,
  pruneOpenCodeConfigAudit,
  recordOpenCodeConfigAudit,
  type OpenCodeConfigAuditActor,
} from '../../src/services/opencode-config-audit'

const actor: OpenCodeConfigAuditActor = {
  userId: 'u-1',
  userEmail: 'Admin@Example.test',
  ipAddress: '198.51.100.4',
  userAgent: 'vitest',
}

describe('opencode-config-audit', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, allMigrations)
  })

  afterEach(() => {
    db.close()
  })

  describe('diffOpenCodeConfig', () => {
    it('names the top-level keys that differ, sorted', () => {
      const { changedKeys, details } = diffOpenCodeConfig(
        { theme: 'dark', model: 'a/b', mcp: { local: {} } },
        { theme: 'light', model: 'a/b', agent: { build: {} } },
      )

      expect(changedKeys).toEqual(['agent', 'mcp', 'theme'])
      expect(details).toBeNull()
    })

    it('treats a key whose value is structurally equal as unchanged', () => {
      const { changedKeys } = diffOpenCodeConfig(
        { permission: { edit: 'ask' } },
        { permission: { edit: 'ask' } },
      )

      expect(changedKeys).toEqual([])
    })

    it('reports a removed top-level key as a change', () => {
      const { changedKeys } = diffOpenCodeConfig({ theme: 'dark', model: 'a/b' }, { theme: 'dark' })

      expect(changedKeys).toEqual(['model'])
    })

    it('separates added from removed provider ids', () => {
      const { details } = diffOpenCodeConfig(
        { provider: { keep: {}, drop: {} } },
        { provider: { keep: {}, added: {} } },
      )

      expect(details).toEqual({ provider: { added: ['added'], removed: ['drop'] } })
    })

    it('carries no provider detail when a provider entry is only edited', () => {
      const { details } = diffOpenCodeConfig(
        { provider: { acme: { options: { baseURL: 'https://old' } } } },
        { provider: { acme: { options: { baseURL: 'https://new' } } } },
      )

      expect(details).toEqual({ provider: { added: [], removed: [] } })
    })

    it('copes with a missing previous document and with non-objects', () => {
      expect(diffOpenCodeConfig(undefined, { theme: 'dark' }).changedKeys).toEqual(['theme'])
      expect(diffOpenCodeConfig(null, undefined).changedKeys).toEqual([])
      expect(diffOpenCodeConfig({ provider: 'nonsense' } as never, { provider: {} }).details)
        .toEqual({ provider: { added: [], removed: [] } })
    })
  })

  describe('record and list', () => {
    it('keeps every field it was given', () => {
      recordOpenCodeConfigAudit(db, {
        actor,
        scope: 'user',
        subject: 'alice',
        source: 'opencodode.jsonc',
        revision: 'rev-1',
        changedKeys: ['provider'],
        details: { provider: { added: ['acme'], removed: [] } },
        restartPending: true,
      })

      const { entries, total } = listOpenCodeConfigAudit(db)
      expect(total).toBe(1)
      expect(entries[0]).toMatchObject({
        userId: 'u-1',
        userEmail: 'Admin@Example.test',
        ipAddress: '198.51.100.4',
        userAgent: 'vitest',
        scope: 'user',
        subject: 'alice',
        source: 'opencodode.jsonc',
        revision: 'rev-1',
        changedKeys: ['provider'],
        details: { provider: { added: ['acme'], removed: [] } },
        restartPending: true,
      })
      expect(entries[0]?.id).toBeTruthy()
      expect(entries[0]?.createdAt).toBeGreaterThan(0)
    })

    it('defaults the optional fields instead of storing the string undefined', () => {
      recordOpenCodeConfigAudit(db, { actor: UNATTRIBUTED_ACTOR, scope: 'global', changedKeys: [] })

      const { entries } = listOpenCodeConfigAudit(db)
      expect(entries[0]?.subject).toBeNull()
      expect(entries[0]?.source).toBeNull()
      expect(entries[0]?.revision).toBeNull()
      expect(entries[0]?.details).toBeNull()
      expect(entries[0]?.restartPending).toBe(false)
    })

    it('reads an unparsable column as empty rather than failing the listing', () => {
      recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: ['theme'] })
      db.prepare('UPDATE opencode_config_audit SET changed_keys = ?, details = ?')
        .run('{not json', '{also not json')

      const { entries } = listOpenCodeConfigAudit(db)
      expect(entries[0]?.changedKeys).toEqual([])
      expect(entries[0]?.details).toBeNull()
    })

    it('filters by user, by email case-insensitively, and by scope', () => {
      recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: ['theme'] })
      recordOpenCodeConfigAudit(db, {
        actor: { ...actor, userId: 'u-2', userEmail: 'other@example.test' },
        scope: 'user',
        subject: 'bob',
        changedKeys: ['provider'],
      })

      expect(listOpenCodeConfigAudit(db, { userId: 'u-2' }).total).toBe(1)
      expect(listOpenCodeConfigAudit(db, { email: 'ADMIN@EXAMPLE' }).total).toBe(1)
      expect(listOpenCodeConfigAudit(db, { scope: 'user' }).total).toBe(1)
      expect(listOpenCodeConfigAudit(db, { scope: 'global' }).total).toBe(1)
      expect(listOpenCodeConfigAudit(db, { email: 'nobody' }).total).toBe(0)
    })

    it('filters by time window and returns newest first', async () => {
      const base = Date.now()
      recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: ['a'] })
      const a = listOpenCodeConfigAudit(db).entries[0]?.id ?? ''
      recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: ['b'] })
      const b = listOpenCodeConfigAudit(db).entries[0]?.id ?? ''
      db.prepare('UPDATE opencode_config_audit SET created_at = 1000 WHERE id = ?').run(a)
      db.prepare('UPDATE opencode_config_audit SET created_at = 2000 WHERE id = ?').run(b)

      expect(listOpenCodeConfigAudit(db, { from: 2000 }).entries.map((e) => e.changedKeys[0])).toEqual(['b'])
      expect(listOpenCodeConfigAudit(db, { to: 1999 }).entries.map((e) => e.changedKeys[0])).toEqual(['a'])
      expect(listOpenCodeConfigAudit(db, { from: base }).total).toBe(0)
    })

    it('paginates and clamps the limit', () => {
      for (let i = 0; i < 5; i += 1) {
        recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: [`k${i}`] })
      }

      const page = listOpenCodeConfigAudit(db, { limit: 2, offset: 1 })
      expect(page.total).toBe(5)
      expect(page.entries).toHaveLength(2)
      expect(listOpenCodeConfigAudit(db, { limit: 0 }).entries).toHaveLength(1)
      expect(listOpenCodeConfigAudit(db, { offset: -5 }).entries).toHaveLength(5)
    })

    it('prunes only rows older than the given moment', () => {
      recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: ['old'] })
      const old = listOpenCodeConfigAudit(db).entries[0]?.id ?? ''
      recordOpenCodeConfigAudit(db, { actor, scope: 'global', changedKeys: ['new'] })
      db.prepare('UPDATE opencode_config_audit SET created_at = 1000 WHERE id = ?').run(old)

      expect(pruneOpenCodeConfigAudit(db, 5000)).toBe(1)
      expect(listOpenCodeConfigAudit(db).entries.map((e) => e.changedKeys[0])).toEqual(['new'])
      expect(pruneOpenCodeConfigAudit(db, 5000)).toBe(0)
    })
  })
})
