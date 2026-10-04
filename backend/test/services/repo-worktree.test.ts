import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { rm } from 'fs/promises'

import { resolveDefaultBranch, createWorktreeSafely, removeWorktree } from '../../src/services/repo'

describe('repo worktree helpers', () => {
  let baseRepoPath: string
  let originRepoPath: string
  let worktreePath: string
  let removableWorktreePath: string
  let tmpDir: string
  const env = process.env as Record<string, string>

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'repo-worktree-test-'))
    originRepoPath = path.join(tmpDir, 'origin.git')
    baseRepoPath = path.join(tmpDir, 'base')
    worktreePath = path.join(tmpDir, 'feature-x')
    removableWorktreePath = path.join(tmpDir, 'feature-removable')

    // Init bare origin
    execSync(`git init --bare "${originRepoPath}"`, { env })

    // Clone origin to get a working base repo (default branch is "master" in bare repos)
    execSync(`git clone "${originRepoPath}" "${baseRepoPath}"`, { env })

    // Set git config for commits
    execSync(`git -C "${baseRepoPath}" config user.email test@test.com`, { env })
    execSync(`git -C "${baseRepoPath}" config user.name Test`, { env })

    // Rename default branch to "main" and push
    execSync(`git -C "${baseRepoPath}" branch -m master main`, { env })
    execSync(`git -C "${baseRepoPath}" commit --allow-empty -m "Initial commit"`, { env })
    execSync(`git -C "${baseRepoPath}" push origin main`, { env })

    // Set bare repo HEAD to main so origin/HEAD is resolvable
    execSync(`git -C "${originRepoPath}" symbolic-ref HEAD refs/heads/main`, { env })
    execSync(`git -C "${baseRepoPath}" remote set-head origin --auto`, { env })
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('resolveDefaultBranch', () => {
    it('resolves default branch from origin/HEAD', async () => {
      const branch = await resolveDefaultBranch(baseRepoPath, env)
      expect(branch).toBe('main')
    })

    it('falls back to main when origin/HEAD cannot be resolved', async () => {
      const branch = await resolveDefaultBranch('/nonexistent/path', env)
      expect(branch).toBe('main')
    })
  })

  describe('createWorktreeSafely', () => {
    it('creates a worktree for a new branch and checks it out', async () => {
      await createWorktreeSafely(baseRepoPath, worktreePath, 'feature/x', env)

      expect(existsSync(worktreePath)).toBe(true)

      const branch = execSync(`git -C "${worktreePath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()
      expect(branch).toBe('feature/x')
    })
  })

  describe('removeWorktree', () => {
    it('removes a worktree directory and prunes the worktree entry', async () => {
      // This test used to remove the directory the createWorktreeSafely test
      // made and merely assert it was there first, so it only passed when that
      // sibling test happened to run earlier. Give this block its own
      // worktree instead of inheriting one: shuffled order put this block
      // first and existsSync() was false.
      await createWorktreeSafely(baseRepoPath, removableWorktreePath, 'feature/removable', env)

      expect(existsSync(removableWorktreePath)).toBe(true)

      await removeWorktree(baseRepoPath, removableWorktreePath)

      expect(existsSync(removableWorktreePath)).toBe(false)

      // Verify pruning — the removed worktree should not appear in the list
      const worktreeList = execSync(`git -C "${baseRepoPath}" worktree list`, { encoding: 'utf-8' })
      expect(worktreeList).not.toContain(removableWorktreePath)
    })
  })

  // The `rm -rf` at the end of removeWorktree runs against whatever path the
  // caller hands over, and one caller hands it the `directory` field of an
  // OpenCode workspace API response verbatim. These are the shapes such a
  // response could carry, and what has to survive them.
  describe('removeWorktree refuses a path that is not a worktree of the base', () => {
    let foreignRepoPath: string
    let plainDir: string
    let plainFile: string
    let baseSymlink: string
    let guardedWorktreePath: string

    beforeEach(() => {
      foreignRepoPath = path.join(tmpDir, 'foreign')
      plainDir = path.join(tmpDir, 'plain')
      plainFile = path.join(plainDir, 'keep.txt')
      baseSymlink = path.join(tmpDir, 'base-symlink')
      guardedWorktreePath = path.join(tmpDir, 'feature-guarded')

      execSync(`git init -q "${foreignRepoPath}"`, { env })
      execSync(`git -C "${foreignRepoPath}" config user.email test@test.com`, { env })
      execSync(`git -C "${foreignRepoPath}" config user.name Test`, { env })
      execSync(`git -C "${foreignRepoPath}" commit -q --allow-empty -m "Unrelated repository"`, { env })

      mkdirSync(plainDir, { recursive: true })
      writeFileSync(plainFile, 'this must survive')

      symlinkSync(baseRepoPath, baseSymlink)
    })

    afterEach(async () => {
      // Unconditionally, even when the path is already gone: removeWorktree
      // is also what clears a stale registration, and leaving one behind makes
      // the next createWorktreeSafely in this block fail on a branch that is
      // still checked out somewhere.
      await removeWorktree(baseRepoPath, guardedWorktreePath)
      rmSync(baseSymlink, { force: true })
      rmSync(foreignRepoPath, { recursive: true, force: true })
      rmSync(plainDir, { recursive: true, force: true })
    })

    it('still removes a real worktree — the refusals below are the exception, not the rule', async () => {
      // Without this, every assertion below ("was refused", "survived") would
      // pass just as well if removeWorktree refused everything or deleted
      // everything.
      await createWorktreeSafely(baseRepoPath, guardedWorktreePath, 'feature/guarded', env)
      expect(existsSync(guardedWorktreePath)).toBe(true)

      const result = await removeWorktree(baseRepoPath, guardedWorktreePath)

      expect(result.removed).toBe(true)
      expect(existsSync(guardedWorktreePath)).toBe(false)
    })

    it('refuses the base repository itself, which is the main checkout', async () => {
      const result = await removeWorktree(baseRepoPath, baseRepoPath)

      expect(result.removed).toBe(false)
      expect(result.refusal).toBeTruthy()
      expect(existsSync(path.join(baseRepoPath, '.git'))).toBe(true)
    })

    it('refuses a symlink that resolves to the base repository', async () => {
      // git reports the same common git dir for a symlink pointing at a
      // repository and for the repository itself, so the git-identity check
      // alone waves this through. This is what the realpath comparison is for.
      const result = await removeWorktree(baseRepoPath, baseSymlink)

      expect(result.removed).toBe(false)
      expect(result.refusal).toBeTruthy()
      expect(existsSync(path.join(baseRepoPath, '.git'))).toBe(true)
    })

    it('refuses an unrelated repository, and that repository survives', async () => {
      const result = await removeWorktree(baseRepoPath, foreignRepoPath)

      expect(result.removed).toBe(false)
      expect(result.refusal).toBeTruthy()
      expect(existsSync(path.join(foreignRepoPath, '.git'))).toBe(true)
    })

    it('refuses a directory that is not a repository, and its contents survive', async () => {
      const result = await removeWorktree(baseRepoPath, plainDir)

      expect(result.removed).toBe(false)
      expect(result.refusal).toBeTruthy()
      expect(existsSync(plainFile)).toBe(true)
    })

    it('leaves the base repository\'s other worktrees alone', async () => {
      // A refusal is scoped to the path it was given. If the guard were failing
      // by damaging the base repository rather than by skipping one path, the
      // worktree created here would go with it.
      await createWorktreeSafely(baseRepoPath, guardedWorktreePath, 'feature/guarded', env)

      await removeWorktree(baseRepoPath, foreignRepoPath)

      expect(existsSync(guardedWorktreePath)).toBe(true)
    })
  })

  describe('removeWorktree on a directory that is already gone', () => {
    let stalePath: string

    beforeEach(() => {
      stalePath = path.join(tmpDir, 'feature-stale')
    })

    afterEach(async () => {
      await removeWorktree(baseRepoPath, stalePath)
    })

    it('still clears the registration git is holding for it', async () => {
      // An earlier crash can take the directory down without git being told.
      // Refusing here would be safe but would strand the registration forever,
      // and the next worktree add on that branch would then fail.
      await createWorktreeSafely(baseRepoPath, stalePath, 'feature/stale', env)
      expect(existsSync(stalePath)).toBe(true)
      rmSync(stalePath, { recursive: true, force: true })

      const result = await removeWorktree(baseRepoPath, stalePath)

      expect(result.removed).toBe(true)
      const worktreeList = execSync(`git -C "${baseRepoPath}" worktree list`, { encoding: 'utf-8' })
      expect(worktreeList).not.toContain(stalePath)
    })
  })
})
