import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'

vi.mock('../../src/services/opencode-models', () => ({
  resolveOpenCodeModel: vi.fn(async () => ({ providerID: 'openai', modelID: 'gpt-5-mini' })),
}))

vi.mock('../../src/services/sse-aggregator', () => ({
  sseAggregator: { onEvent: vi.fn(() => vi.fn()) },
}))

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('../../src/utils/logger', () => ({
  logger: { warn: loggerWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { ScheduleService } from '../../src/services/schedules'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { findAgentSession } from '../../src/services/agent-session'
import { createTestDb } from '../helpers/assistant-workspace'

/**
 * A scheduled run is the hard case for "who is this": cron fired it, nobody is
 * signed in, and the directory it runs in is a fresh worktree that contains no
 * user name at all. The repo owner is the only person it can honestly be
 * attributed to, and that is what these tests pin down.
 */

const SESSION_ID = 'ses-scheduled-1'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function createClient(): OpenCodeClient {
  const forward = vi.fn(async (req: { path: string; method: string }) => {
    if (req.path === '/session' && req.method === 'POST') return jsonResponse({ id: SESSION_ID })
    if (req.path === `/session/${SESSION_ID}/prompt_async`) return new Response('', { status: 200 })
    if (req.path === '/session/status') return jsonResponse({ [SESSION_ID]: { type: 'idle' } })
    if (req.path === `/session/${SESSION_ID}/message`) {
      return jsonResponse([
        { info: { role: 'assistant', time: { completed: Date.now() } }, parts: [{ type: 'text', text: 'done' }] },
      ])
    }
    return new Response('', { status: 404 })
  })

  return {
    forward: forward as unknown as OpenCodeClient['forward'],
    forwardRaw: vi.fn(async () => new Response('', { status: 200 })),
    getJson: vi.fn(async () => ({}) as unknown),
    postJson: vi.fn(async () => ({}) as unknown),
    setProviderAuth: vi.fn(async () => true),
    deleteProviderAuth: vi.fn(async () => true),
  } as OpenCodeClient
}

function createWorktreeManager(directory: string | null = null) {
  return {
    prepare: vi.fn(async () => (directory
      ? { directory, worktreePath: directory, runBranch: 'run/7', workspaceId: 'ws-1' }
      : null)),
    finalize: vi.fn(async () => ({ commitHash: null })),
    pruneRunArtifacts: vi.fn(async () => undefined),
  }
}

function seed(db: Database, options: { userId: string | null; role?: string }): void {
  const now = Date.now()
  if (options.userId) {
    db.prepare(
      `INSERT INTO "user" ("id", "name", "email", "username", "role", "emailVerified", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(options.userId, options.userId, `${options.userId}@example.com`, options.userId, options.role ?? 'user', now, now)
  }
  db.prepare(
    `INSERT INTO repos (id, repo_url, local_path, default_branch, clone_status, cloned_at, user_id)
     VALUES (42, 'https://github.com/example/sample.git', 'sample', 'main', 'ready', ?, ?)`,
  ).run(now, options.userId)
  db.prepare(
    `INSERT INTO schedule_jobs (id, repo_id, name, enabled, schedule_mode, prompt, created_at, updated_at)
     VALUES (7, 42, 'Nightly', 1, 'interval', 'Summarize the repository.', ?, ?)`,
  ).run(now, now)
}

describe('recording who a scheduled OpenCode session belongs to', () => {
  let db: Database

  beforeEach(() => {
    vi.clearAllMocks()
    db = createTestDb()
  })

  it('attributes the session to the owner of the repository it runs against', async () => {
    seed(db, { userId: 'u-alice' })
    const service = new ScheduleService(db, createClient(), createWorktreeManager() as never)

    await service.runJob(42, 7, 'manual')

    expect(findAgentSession(db, SESSION_ID)).toMatchObject({
      sessionId: SESSION_ID,
      userId: 'u-alice',
      username: 'u-alice',
      role: 'user',
      source: 'schedule',
    })
  })

  it('keeps an administrator owner marked as one', async () => {
    seed(db, { userId: 'u-root', role: 'admin' })
    const service = new ScheduleService(db, createClient(), createWorktreeManager() as never)

    await service.runJob(42, 7, 'manual')

    expect(findAgentSession(db, SESSION_ID)).toMatchObject({ userId: 'u-root', role: 'admin' })
  })

  it('records the worktree the run actually executed in', async () => {
    // This is the directory that makes a directory useless as an identity:
    // /workspace/schedule-worktrees/job-7-run-5 names a job and a run, and no
    // user. It is kept for auditing; the owner column above is what counts.
    seed(db, { userId: 'u-alice' })
    const worktreeDir = '/workspace/schedule-worktrees/job-7-run-5'
    const service = new ScheduleService(db, createClient(), createWorktreeManager(worktreeDir) as never)

    await service.runJob(42, 7, 'manual')

    expect(findAgentSession(db, SESSION_ID)).toMatchObject({
      directory: worktreeDir,
      userId: 'u-alice',
    })
  })

  it('records the repository path when the run was not isolated in a worktree', async () => {
    seed(db, { userId: 'u-alice' })
    const service = new ScheduleService(db, createClient(), createWorktreeManager() as never)

    await service.runJob(42, 7, 'manual')

    expect(findAgentSession(db, SESSION_ID)?.directory).toBeTruthy()
  })

  it('records no identity for a repository nobody owns, rather than a wrong one', async () => {
    seed(db, { userId: null })
    const service = new ScheduleService(db, createClient(), createWorktreeManager() as never)

    await service.runJob(42, 7, 'manual')

    const found = findAgentSession(db, SESSION_ID)
    expect(found).toMatchObject({ userId: null, username: null, role: 'unknown', source: 'schedule' })
  })

  it('completes the run even when the owner cannot be written down', async () => {
    // Same trade as the proxy: losing the note costs us one session we can no
    // longer place. Failing the run would cost the user the run itself.
    seed(db, { userId: 'u-alice' })
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('ocm_agent_session')) throw new Error('write refused')
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, prop) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as Database
    const service = new ScheduleService(failing, createClient(), createWorktreeManager() as never)

    const run = await service.runJob(42, 7, 'manual')

    expect(run.sessionId).toBe(SESSION_ID)
    expect(loggerWarn).toHaveBeenCalled()
    expect(findAgentSession(db, SESSION_ID)).toBeNull()
  })
})
