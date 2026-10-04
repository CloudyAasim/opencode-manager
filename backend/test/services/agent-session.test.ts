import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import { findAgentSession, recordAgentSession, resolveRepoOwnerIdentity } from '../../src/services/agent-session'
import { createTestDb } from '../helpers/assistant-workspace'

function insertUser(db: Database, id: string, username: string, role: string): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, id, `${id}@example.com`, username, role, now, now)
}

function insertRepo(db: Database, id: number, localPath: string, userId: string | null): void {
  db.prepare(
    `INSERT INTO repos (id, repo_url, local_path, default_branch, clone_status, cloned_at, user_id)
     VALUES (?, ?, ?, 'main', 'ready', ?, ?)`,
  ).run(id, `https://example.com/${localPath}.git`, localPath, Date.now(), userId)
}

describe('agent session ownership', () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('reads back every field it was given', () => {
    const before = Date.now()
    recordAgentSession(db, {
      sessionId: 'ses_full',
      userId: 'u1',
      username: 'alice',
      role: 'user',
      directory: '/workspace/users/alice',
      source: 'proxy',
    })

    const found = findAgentSession(db, 'ses_full')

    expect(found).toMatchObject({
      sessionId: 'ses_full',
      userId: 'u1',
      username: 'alice',
      role: 'user',
      directory: '/workspace/users/alice',
      source: 'proxy',
    })
    expect(found?.createdAt).toBeGreaterThanOrEqual(before)
  })

  /**
   * A second write for the same session id has to win, not be ignored. A
   * retained first row is the failure that matters: it names a tenant who no
   * longer owns the session, and every later access decision reads that name.
   */
  it('lets a later write correct the owner of an already recorded session', () => {
    recordAgentSession(db, {
      sessionId: 'ses_stale',
      userId: 'u1',
      username: 'alice',
      role: 'user',
      directory: '/workspace/users/alice',
      source: 'proxy',
    })
    recordAgentSession(db, {
      sessionId: 'ses_stale',
      userId: 'u2',
      username: 'bob',
      role: 'user',
      directory: '/workspace/users/bob',
      source: 'schedule',
    })

    expect(findAgentSession(db, 'ses_stale')).toMatchObject({
      userId: 'u2',
      username: 'bob',
      source: 'schedule',
    })
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM ocm_agent_session WHERE session_id = ?')
      .get('ses_stale') as { n: number }
    expect(count.n).toBe(1)
  })

  it('has nothing to say about a session it never saw', () => {
    expect(findAgentSession(db, 'ses_never')).toBeNull()
  })

  it('attributes a repository to its owner', () => {
    insertUser(db, 'u-alice', 'alice', 'user')
    insertRepo(db, 42, 'sample', 'u-alice')

    expect(resolveRepoOwnerIdentity(db, 42)).toEqual({
      userId: 'u-alice',
      username: 'alice',
      role: 'user',
    })
  })

  it('keeps an administrator marked as one', () => {
    // The role decides how wide the access roots are later, so collapsing
    // every owner into 'user' would quietly demote the administrator.
    insertUser(db, 'u-root', 'root', 'admin')
    insertRepo(db, 43, 'infra', 'u-root')

    expect(resolveRepoOwnerIdentity(db, 43)).toEqual({
      userId: 'u-root',
      username: 'root',
      role: 'admin',
    })
  })

  it('reports an unowned repository as unknown rather than guessing one', () => {
    insertRepo(db, 44, 'shared', null)

    // Migration 22 backfilled owners, so this should not happen - but a repo
    // created outside that path would, and inventing an identity here is how
    // a session gets handed to whoever holds a matching id.
    expect(resolveRepoOwnerIdentity(db, 44)).toEqual({
      userId: null,
      username: null,
      role: 'unknown',
    })
  })

  it('reports a dangling owner as unknown', () => {
    // The LEFT JOIN is the point: repos.user_id is not a foreign key, so it can
    // outlive the row it names.
    insertRepo(db, 45, 'orphan', 'u-deleted')

    expect(resolveRepoOwnerIdentity(db, 45)).toEqual({
      userId: null,
      username: null,
      role: 'unknown',
    })
  })

  it('reports a repository that does not exist as unknown', () => {
    expect(resolveRepoOwnerIdentity(db, 999)).toEqual({
      userId: null,
      username: null,
      role: 'unknown',
    })
  })
})
