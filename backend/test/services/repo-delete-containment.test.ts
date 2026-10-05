import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Database } from 'bun:sqlite'

/**
 * `deleteRepoFiles` shells out to `rm -rf <localPath>` with the repositories
 * directory as the working directory. `localPath` is a column in SQLite, and
 * the only normalisation ever applied to it is trimming trailing slashes, so
 * anything that can write that column decides what `rm -rf` is pointed at.
 *
 * These tests use the real filesystem on purpose, and they check the
 * *consequence* before the error. "the mock was not called" passes just as
 * well against a guard that still deletes things, and asserting `rejects`
 * first aborts before the evidence is looked at - which is exactly how a
 * "the promise resolved" failure can be mistaken for "nothing bad happened".
 */

// Point the repositories directory at a temp dir so `rm` really runs.
const envRef = { reposBase: '' }

vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return { ...actual, getReposPath: () => envRef.reposBase }
})

// No tenant scope, so reposBase() falls through to getReposPath().
vi.mock('../../src/auth/access-scope', () => ({
  getAccessScope: () => null,
}))

const getRepoById = vi.fn()
const deleteRepo = vi.fn()
const createRepo = vi.fn()
const getRepoByLocalPath = vi.fn()
const updateRepoStatus = vi.fn()
// `ownedBy` / `anyOwner` are pure scope constructors with no database behind
// them, so the real implementations are the honest ones to hand back. Leaving
// them out does not fail loudly - the modules under test receive `undefined`
// and every scoped lookup quietly degrades to "no owner". Deliberately not
// spreading `importActual`: a mock that leaks every real export stops
// reporting the ones it forgot.
vi.mock('../../src/db/queries', async () => {
  const { ownedBy } = await vi.importActual<typeof import('../../src/db/queries')>('../../src/db/queries')

  return {
    getRepoById: (...args: unknown[]) => getRepoById(...args),
    deleteRepo: (...args: unknown[]) => deleteRepo(...args),
    createRepo: (...args: unknown[]) => createRepo(...args),
    getRepoByLocalPath: (...args: unknown[]) => getRepoByLocalPath(...args),
    getRepoByUrlAndBranch: vi.fn(),
    updateRepoStatus: (...args: unknown[]) => updateRepoStatus(...args),
    ownedBy,
  }
})

// Partial: delete.ts wants a stub URL parser, but the entry-point test below
// needs the real initLocalRepo out of this same module.
vi.mock('../../src/services/repo/clone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/repo/clone')>()),
  normalizeRepoUrl: () => ({ name: 'base-repo' }),
}))
vi.mock('../../src/services/repo/worktree', () => ({
  // Typed result, not a bare vi.fn(): delete.ts branches on `removed`, so a
  // mock that answers undefined would read as "refused" and quietly turn the
  // normal worktree deletion test below into a false failure.
  removeWorktree: vi.fn(async (): Promise<{ removed: boolean; refusal?: string }> => ({ removed: true })),
  createWorktreeSafely: vi.fn(),
}))
import { deleteRepoFiles } from '../../src/services/repo/delete'
import { removeWorktree } from '../../src/services/repo/worktree'
import { initLocalRepo } from '../../src/services/repo/clone'

const db = {} as Database

function repo(localPath: string, overrides: Record<string, unknown> = {}) {
  return { id: 1, repoUrl: null, localPath, isWorktree: false, ...overrides }
}

describe('删除项目时目标必须留在项目目录内', () => {
  let tmpDir: string
  let base: string
  let victim: string
  let victimFile: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ocm-delete-containment-'))
    base = path.join(tmpDir, 'repos')
    victim = path.join(tmpDir, 'victim')
    victimFile = path.join(victim, 'important.txt')
    mkdirSync(base, { recursive: true })
    mkdirSync(victim, { recursive: true })
    writeFileSync(victimFile, 'this must survive')

    envRef.reposBase = base
    getRepoById.mockReset()
    deleteRepo.mockReset()
    // mockReset, not mockClear: a once-implementation queued by one test would
    // otherwise be handed to the next one. The default is re-stated here
    // because the reset just took it away.
    vi.mocked(removeWorktree).mockReset()
    vi.mocked(removeWorktree).mockResolvedValue({ removed: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('正常删除不能被这次修复堵上', () => {
    it('目录内的检出照常删除', async () => {
      mkdirSync(path.join(base, 'demo'))

      getRepoById.mockReturnValue(repo('demo'))
      await deleteRepoFiles(db, 1)

      expect(existsSync(path.join(base, 'demo'))).toBe(false)
      expect(deleteRepo).toHaveBeenCalledWith(db, 1)
    })

    it('嵌套目录照常删除', async () => {
      mkdirSync(path.join(base, 'group', 'demo'), { recursive: true })

      getRepoById.mockReturnValue(repo('group/demo'))
      await deleteRepoFiles(db, 1)

      expect(existsSync(path.join(base, 'group', 'demo'))).toBe(false)
    })

    it('带前导 `./` 的路径照常删除', async () => {
      mkdirSync(path.join(base, 'demo'))

      getRepoById.mockReturnValue(repo('./demo'))
      await deleteRepoFiles(db, 1)

      expect(existsSync(path.join(base, 'demo'))).toBe(false)
    })
  })

  describe('爬出项目目录的路径', () => {
    const escapes = [
      // `path.relative` returns a bare '..' for the direct parent - with no
      // trailing separator - so `startsWith('..' + sep)` does not catch it.
      // This is the one that would take the whole user workspace, not just a
      // checkout.
      { name: '`..` 本身', localPath: () => '..' },
      { name: '`../`', localPath: () => '../victim' },
      { name: '多层 `../`', localPath: () => '../../victim' },
      { name: '深层 `../`', localPath: () => '../../../../../../victim' },
      { name: '中间的 `../`', localPath: () => 'group/../../victim' },
      { name: '绝对路径指向目录外', localPath: (v: string) => v },
    ]

    for (const escape of escapes) {
      it(`${escape.name} 不能删掉目录外的文件`, async () => {
        // `group` has to exist: without it the OS cannot resolve
        // `group/../../victim` at all and nothing gets deleted. That is an
        // accident of a missing directory, not a guard, and it disappears the
        // moment someone creates `group`.
        mkdirSync(path.join(base, 'group'), { recursive: true })

        getRepoById.mockReturnValue(repo(escape.localPath(victim)))

        await deleteRepoFiles(db, 1).catch(() => {})

        expect(existsSync(victimFile), `${escape.localPath(victim)} 把目录外的文件删掉了`).toBe(true)
      })

      it(`${escape.name} 必须被拒绝,且不留下一行删不掉的记录`, async () => {
        getRepoById.mockReturnValue(repo(escape.localPath(victim)))

        const result = await deleteRepoFiles(db, 1)

        // The contract here used to be "throws, row kept". That was a trap I
        // built: a row like this cannot be removed from the UI at all, so the
        // user is stuck with it forever. The row goes, the filesystem is left
        // alone, and the refusal is reported rather than swallowed.
        expect(result.filesRemoved, '明明没删文件却说删了').toBe(false)
        expect(result.refusal).toBeTruthy()
        expect(deleteRepo).toHaveBeenCalledWith(db, 1)
      })
    }

    it('指向项目目录内部的绝对路径也不接受 —— 它是另一个写法的同一个列', async () => {
      // The base check already covers where this points. It is refused anyway
      // because `local_path` is relative everywhere else, and worktree
      // directory naming does string surgery on that relative form.
      const inside = path.join(base, 'mine')
      mkdirSync(inside, { recursive: true })

      getRepoById.mockReturnValue(repo(inside))

      await deleteRepoFiles(db, 1).catch(() => {})

      expect(existsSync(inside)).toBe(true)
    })

    it('正常删除时 filesRemoved 为真', async () => {
      mkdirSync(path.join(base, 'demo'))

      getRepoById.mockReturnValue(repo('demo'))
      const result = await deleteRepoFiles(db, 1)

      expect(result.filesRemoved).toBe(true)
      expect(result.refusal).toBeUndefined()
      expect(deleteRepo).toHaveBeenCalledWith(db, 1)
    })

    it('项目目录本身也不接受 —— rm -rf 会带走里面所有检出', async () => {
      getRepoById.mockReturnValue(repo('.'))

      const result = await deleteRepoFiles(db, 1)

      expect(result.filesRemoved).toBe(false)
      expect(existsSync(base)).toBe(true)
    })

    it('`..` 不接受 —— 那会删掉项目目录的父目录,也就是整个工作区', async () => {
      getRepoById.mockReturnValue(repo('..'))

      const result = await deleteRepoFiles(db, 1)

      // base and victim both live under tmpDir, so this covers the parent too.
      expect(result.filesRemoved).toBe(false)
      expect(existsSync(tmpDir), '项目目录的父目录被删掉了').toBe(true)
      expect(existsSync(base)).toBe(true)
      expect(existsSync(victimFile)).toBe(true)
    })

    it('空的 localPath 不接受', async () => {
      getRepoById.mockReturnValue(repo(''))

      const result = await deleteRepoFiles(db, 1)

      expect(result.filesRemoved).toBe(false)
      expect(existsSync(base)).toBe(true)
    })

    it('坏行被清掉之后不留半截状态:不调 removeWorktree,不动 git', async () => {
      // A worktree row also has to unregister itself from git. With the path
      // refused there is nothing to unregister, so no attempt is made.
      getRepoById.mockReturnValue(repo('../victim', { isWorktree: true, repoUrl: 'https://github.com/x/y.git' }))

      await deleteRepoFiles(db, 1)

      expect(removeWorktree).not.toHaveBeenCalled()
      expect(deleteRepo).toHaveBeenCalledWith(db, 1)
    })

    it('正常的 worktree 行照常调 removeWorktree —— 上一条才有意义', async () => {
      // Without this, "removeWorktree was not called" above would also pass if
      // removeWorktree were simply never called for anything, and the guard
      // would look load-bearing when it was not.
      const checkout = path.join(base, 'demo')
      mkdirSync(checkout, { recursive: true })
      getRepoById.mockReturnValue(repo('demo', { isWorktree: true, repoUrl: 'https://github.com/x/y.git' }))

      const result = await deleteRepoFiles(db, 1)

      expect(removeWorktree).toHaveBeenCalledWith(
        path.join(base, 'base-repo'),
        checkout,
      )
      expect(result.filesRemoved).toBe(true)
      expect(existsSync(checkout)).toBe(false)
    })

    it('removeWorktree 拒绝时:删行,不动磁盘,并说明原因', async () => {
      // The path clears the containment check - it is inside the repositories
      // directory - but removeWorktree is what knows whether it is a worktree
      // of the base repository the row names. Falling through to the `rm -rf`
      // after a refusal would delete whatever is really there, which is the
      // entire reason the refusal happened.
      const checkout = path.join(base, 'demo')
      mkdirSync(checkout, { recursive: true })
      writeFileSync(path.join(checkout, 'real-content.txt'), 'this must survive')
      getRepoById.mockReturnValue(repo('demo', { isWorktree: true, repoUrl: 'https://github.com/x/y.git' }))
      vi.mocked(removeWorktree).mockResolvedValueOnce({ removed: false, refusal: 'it belongs to a different repository' })

      const result = await deleteRepoFiles(db, 1)

      expect(result.filesRemoved).toBe(false)
      expect(result.refusal).toBeTruthy()
      expect(existsSync(path.join(checkout, 'real-content.txt'))).toBe(true)
      expect(deleteRepo).toHaveBeenCalledWith(db, 1)
    })
  })

  describe('入口：逃逸的路径根本进不了数据库', () => {
    it('添加本地项目时 `../` 被拒绝,且不留下数据库行', async () => {
      // The delete-side check is the one that stops the damage. This one stops
      // the row from ever existing, which is why the rollback `rm -rf` in the
      // same function cannot be reached with a traversing path either.
      await expect(initLocalRepo(db, {} as never, '../victim')).rejects.toThrow()

      expect(createRepo).not.toHaveBeenCalled()
    })

    it('添加本地项目时多层 `../` 同样被拒绝', async () => {
      await expect(initLocalRepo(db, {} as never, '../../victim')).rejects.toThrow()

      expect(createRepo).not.toHaveBeenCalled()
    })

    it('添加本地项目时目录内的路径照常走通', async () => {
      getRepoByLocalPath.mockReturnValue({ id: 9, localPath: 'demo' })
      const { ownedBy } = await import('../../src/db/queries')

      // It stops at the "already exists" branch, which is enough to prove the
      // path was accepted rather than rejected.
      await initLocalRepo(db, {} as never, 'demo')

      expect(getRepoByLocalPath).toHaveBeenCalledWith(db, 'demo', ownedBy(null))
      expect(createRepo).not.toHaveBeenCalled()
    })
  })
})
