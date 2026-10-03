import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'
import type { Database } from 'bun:sqlite'
import type { Repo } from '../../src/types/repo'

let tmpRoot: string
vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    getReposPath: () => tmpRoot,
    getWorkspacePath: vi.fn(() => '/tmp/fake-workspace'),
  }
})

describe('mirror target resolution', () => {
  let db: Database
  let base: Repo
  let baseRepoPath: string

  beforeAll(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'repo-mirror-target-'))
    baseRepoPath = join(tmpRoot, 'my-app')
    execSync(`git init -b main "${baseRepoPath}"`)
    execSync(`git -C "${baseRepoPath}" config user.email test@test.com`)
    execSync(`git -C "${baseRepoPath}" config user.name Test`)
    execSync(`git -C "${baseRepoPath}" commit --allow-empty -m "Initial commit"`)

    const { createTestDb } = await import('../helpers/assistant-workspace')
    const { createRepo } = await import('../../src/db/queries')
    db = createTestDb()
    base = createRepo(db, { isLocal: true, localPath: 'my-app', branch: 'main', defaultBranch: 'main', cloneStatus: 'ready', clonedAt: Date.now() })
  })

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('targets the repo in place when its checked-out branch matches', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    const plan = await planMirrorTarget(db, base, 'main')
    expect(plan.kind).toBe('in-place')
    expect(plan.currentBranch).toBe('main')
  })

  it('plans a new sibling worktree when the checked-out branch differs', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    // A branch of this test's own. 'feature/x' was only unclaimed while the
    // test that materialises it had not run yet, so the plan came back
    // 'existing' as soon as that test went first.
    const plan = await planMirrorTarget(db, base, 'feature/planned')
    expect(plan).toMatchObject({ kind: 'new', localPath: 'my-app-feature-planned', fullPath: join(tmpRoot, 'my-app-feature-planned'), currentBranch: 'main' })
  })

  it('creates the worktree, the branch, and a worktree repo row without touching the base checkout', async () => {
    const { ensureMirrorTarget, planMirrorTarget } = await import('../../src/services/repo')
    const { repo: target, created } = await ensureMirrorTarget(db, base, 'feature/x')

    expect(created).toBe(true)
    expect(target.id).not.toBe(base.id)
    expect(target.isWorktree).toBe(true)
    expect(target.branch).toBe('feature/x')
    expect(target.fullPath).toBe(join(tmpRoot, 'my-app-feature-x'))
    expect(existsSync(target.fullPath)).toBe(true)
    expect(execSync(`git -C "${target.fullPath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('feature/x')
    expect(execSync(`git -C "${baseRepoPath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('main')

    const again = await planMirrorTarget(db, base, 'feature/x')
    expect(again.kind).toBe('existing')
    if (again.kind === 'existing') expect(again.repo.id).toBe(target.id)

    const second = await ensureMirrorTarget(db, base, 'feature/x')
    expect(second.created).toBe(false)
    expect(second.repo.id).toBe(target.id)
  })

  it('rejects a branch whose sanitized path is occupied by a worktree for another branch and preserves that worktree', async () => {
    const { ensureMirrorTarget, planMirrorTarget } = await import('../../src/services/repo')
    const { getRepoByLocalPath } = await import('../../src/db/queries')

    // Materialise the occupying worktree here. It used to be the one left
    // behind by "creates the worktree, the branch, ...", so this test only
    // had a worktree to preserve when that test happened to run first.
    const { repo: owner } = await ensureMirrorTarget(db, base, 'feature/occupied')
    const occupiedPath = owner.fullPath
    expect(existsSync(occupiedPath)).toBe(true)

    await expect(planMirrorTarget(db, base, 'feature-occupied')).rejects.toThrow(/occupied by repo .* 'feature\/occupied' instead of 'feature-occupied'/)

    const ownerRow = getRepoByLocalPath(db, 'my-app-feature-occupied')!
    expect(ownerRow.branch).toBe('feature/occupied')
    expect(existsSync(occupiedPath)).toBe(true)
    expect(execSync(`git -C "${occupiedPath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('feature/occupied')
  })

  it('rejects an existing row matching the branch when its directory has a different branch checked out', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    const { createRepo } = await import('../../src/db/queries')

    const stalePath = join(tmpRoot, 'my-app-stale')
    execSync(`git clone "${baseRepoPath}" "${stalePath}"`)
    expect(execSync(`git -C "${stalePath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()).toBe('main')

    createRepo(db, { isLocal: true, localPath: 'my-app-stale', branch: 'stale', defaultBranch: 'stale', cloneStatus: 'ready', clonedAt: Date.now() })

    await expect(planMirrorTarget(db, base, 'stale')).rejects.toThrow(/has branch 'main' checked out at/)
    expect(existsSync(stalePath)).toBe(true)
  })

  it('rejects an existing row matching the branch when its worktree directory is missing', async () => {
    const { planMirrorTarget } = await import('../../src/services/repo')
    const { createRepo } = await import('../../src/db/queries')

    createRepo(db, { isLocal: true, localPath: 'my-app-ghost', branch: 'ghost', defaultBranch: 'ghost', cloneStatus: 'ready', clonedAt: Date.now() })

    await expect(planMirrorTarget(db, base, 'ghost')).rejects.toThrow(/missing its worktree directory/)
    expect(existsSync(join(tmpRoot, 'my-app-ghost'))).toBe(false)
  })

  it('removes the created worktree and rethrows when registration fails', async () => {
    const { ensureMirrorTarget } = await import('../../src/services/repo')
    const { getRepoByLocalPath } = await import('../../src/db/queries')

    db.exec(`CREATE TRIGGER fail_mirror_repo_insert BEFORE INSERT ON repos
      WHEN NEW.local_path = 'my-app-feature-fail'
      BEGIN
        SELECT RAISE(ABORT, 'registration failed');
      END;`)

    try {
      const failedPath = join(tmpRoot, 'my-app-feature-fail')
      await expect(ensureMirrorTarget(db, base, 'feature/fail')).rejects.toThrow(/registration failed/)

      expect(existsSync(failedPath)).toBe(false)
      expect(execSync(`git -C "${baseRepoPath}" worktree list`, { encoding: 'utf-8' })).not.toContain('feature-fail')
      expect(getRepoByLocalPath(db, 'my-app-feature-fail')).toBeNull()
    } finally {
      db.exec('DROP TRIGGER fail_mirror_repo_insert')
    }
  })

  it('resolves the base directory name when asked from a worktree repo row', async () => {
    const { ensureMirrorTarget, planMirrorTarget } = await import('../../src/services/repo')
    // Build this test's own worktree row. Reading the 'my-app-feature-x' row
    // meant depending on another test having registered it, and this threw
    // "Cannot read properties of null (reading 'fullPath')" when it ran first.
    const { repo: worktreeRepo } = await ensureMirrorTarget(db, base, 'feature/base-name')
    const plan = await planMirrorTarget(db, worktreeRepo, 'other')
    expect(plan).toMatchObject({ kind: 'new', localPath: 'my-app-other' })
  })
})
