import { describe, expect, it, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import type { Repo } from '../../src/types/repo'
import {
  classifyDirectory,
  formatMissingDirectoriesWarning,
  probeRepoDirectory,
  reconcileRepoDirectories,
  type DirectoryProbe,
  type DirectoryState,
} from '../../src/services/repo/directory-state'

const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

/**
 * A statSync stand-in driven by a path -> answer map. `undefined` means "not
 * there" (Node's throwIfNoEntry:false contract), an object means "throw this
 * errno", and 'dir'/'file' come back as Stats-shaped objects. The errno has to
 * be an object rather than a string because 'dir' is a string too.
 */
type StatAnswer = 'dir' | 'file' | { code: string } | undefined

function fakeStat(answers: Record<string, StatAnswer>) {
  return ((target: fsPath) => {
    const key = String(target)
    const answer = key in answers ? answers[key] : undefined
    if (answer === undefined) return undefined
    if (typeof answer === 'object') throw err(answer.code)
    const isDirectory = answer === 'dir'
    return { isDirectory: () => isDirectory, isFile: () => !isDirectory } as never
  }) as unknown as typeof import('node:fs').statSync
}

type fsPath = Parameters<typeof import('node:fs').statSync>[0]

const repo = (over: Partial<Repo> = {}): Repo =>
  ({
    id: 1,
    localPath: 'demo',
    fullPath: '/workspace/repos/demo',
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: 0,
    ...over,
  }) as Repo

const probeOf = (state: DirectoryState, looksLikeCheckout = false): DirectoryProbe => ({
  state,
  directoryExists: state !== 'missing',
  looksLikeCheckout: state === 'present' && looksLikeCheckout,
})

describe('classifyDirectory', () => {
  it('reports a real directory as present', () => {
    expect(classifyDirectory('/a', fakeStat({ '/a': 'dir' }))).toBe('present')
  })

  it('reports an absent path as missing', () => {
    expect(classifyDirectory('/a', fakeStat({}))).toBe('missing')
  })

  it('reports a path whose component is a file as missing, not as unreadable', () => {
    // ENOTDIR is not suppressed by throwIfNoEntry, and it still means the path
    // cannot be a checkout.
    expect(classifyDirectory('/a/b', fakeStat({ '/a/b': { code: 'ENOTDIR' } }))).toBe('missing')
  })

  it('reports a regular file where a directory is expected as missing', () => {
    expect(classifyDirectory('/a', fakeStat({ '/a': 'file' }))).toBe('missing')
  })

  it('does not claim a directory is gone when it simply could not be read', () => {
    // The dangerous direction: a permissions problem reported as "deleted"
    // would take a working repository out of service.
    expect(classifyDirectory('/a', fakeStat({ '/a': { code: 'EACCES' } }))).toBe('unknown')
  })

  it('treats an empty path as missing', () => {
    expect(classifyDirectory('')).toBe('missing')
  })
})

describe('probeRepoDirectory', () => {
  it('counts an unreadable directory as existing', () => {
    const probe = probeRepoDirectory('/a', fakeStat({ '/a': { code: 'EACCES' } }))
    expect(probe.state).toBe('unknown')
    expect(probe.directoryExists).toBe(true)
  })

  it('accepts a .git directory as a checkout', () => {
    const probe = probeRepoDirectory('/a', fakeStat({ '/a': 'dir', '/a/.git': 'dir' }))
    expect(probe.looksLikeCheckout).toBe(true)
  })

  it('accepts a .git file as a checkout, because a worktree has one', () => {
    const probe = probeRepoDirectory('/a', fakeStat({ '/a': 'dir', '/a/.git': 'file' }))
    expect(probe.looksLikeCheckout).toBe(true)
  })

  it('does not call a directory without .git a checkout', () => {
    // A clone that failed halfway leaves exactly this behind.
    const probe = probeRepoDirectory('/a', fakeStat({ '/a': 'dir' }))
    expect(probe.directoryExists).toBe(true)
    expect(probe.looksLikeCheckout).toBe(false)
  })

  it('reports the directory as gone when it is', () => {
    const probe = probeRepoDirectory('/a', fakeStat({}))
    expect(probe.directoryExists).toBe(false)
    expect(probe.looksLikeCheckout).toBe(false)
  })

  it('does not read .git when the directory itself is gone', () => {
    const statSync = vi.fn(() => undefined)
    probeRepoDirectory('/a', statSync as unknown as typeof import('node:fs').statSync)
    expect(statSync).toHaveBeenCalledTimes(1)
  })
})

describe('reconcileRepoDirectories', () => {
  const run = (repos: Repo[], probe: (fullPath: string) => DirectoryProbe) => {
    const setStatus = vi.fn()
    const report = reconcileRepoDirectories({} as Database, { repos, probe, setStatus })
    return { report, setStatus }
  }

  it('marks a ready repository whose directory is gone as an error', () => {
    const { report, setStatus } = run([repo()], () => probeOf('missing'))

    expect(setStatus).toHaveBeenCalledWith(1, 'error')
    expect(report.markedMissing).toHaveLength(1)
    expect(report.markedMissing[0]).toMatchObject({ id: 1, from: 'ready', to: 'error' })
  })

  it('marks an error repository ready again once its checkout is back', () => {
    const { report, setStatus } = run(
      [repo({ cloneStatus: 'error' })],
      () => probeOf('present', true)
    )

    expect(setStatus).toHaveBeenCalledWith(1, 'ready')
    expect(report.markedRestored).toHaveLength(1)
  })

  it('leaves an error repository alone when the directory has no .git', () => {
    // Restoring on "the directory exists" alone would resurrect a clone that
    // failed halfway and left an empty directory behind.
    const { report, setStatus } = run(
      [repo({ cloneStatus: 'error' })],
      () => probeOf('present', false)
    )

    expect(setStatus).not.toHaveBeenCalled()
    expect(report.markedRestored).toHaveLength(0)
  })

  it('never touches a repository whose clone is still in flight', () => {
    // A clone in progress has no directory yet. Calling that broken would
    // abort work that is succeeding.
    const { report, setStatus } = run(
      [repo({ cloneStatus: 'cloning' })],
      () => probeOf('missing')
    )

    expect(setStatus).not.toHaveBeenCalled()
    expect(report.inFlight).toBe(1)
  })

  it('leaves a repository it could not read exactly as it was', () => {
    const { report, setStatus } = run([repo()], () => probeOf('unknown'))

    expect(setStatus).not.toHaveBeenCalled()
    expect(report.unreadable).toEqual(['/workspace/repos/demo'])
  })

  it('leaves a healthy repository alone', () => {
    const { report, setStatus } = run([repo()], () => probeOf('present', true))

    expect(setStatus).not.toHaveBeenCalled()
    expect(report.markedMissing).toHaveLength(0)
    expect(report.markedRestored).toHaveLength(0)
  })

  it('reports every repository it looked at', () => {
    const { report } = run([repo(), repo({ id: 2 }), repo({ id: 3, cloneStatus: 'cloning' })], () =>
      probeOf('missing')
    )
    expect(report.checked).toBe(3)
  })

  it('probes the path the row records, not a name it could have had', () => {
    const probe = vi.fn(() => probeOf('missing'))
    run([repo({ fullPath: '/somewhere/else' })], probe)
    expect(probe).toHaveBeenCalledWith('/somewhere/else')
  })
})

describe('formatMissingDirectoriesWarning', () => {
  it('names every missing path and says the status was corrected', () => {
    const report = reconcileRepoDirectories({} as Database, {
      repos: [repo(), repo({ id: 2, localPath: 'other', fullPath: '/workspace/repos/other' })],
      probe: () => probeOf('missing'),
      setStatus: () => {},
    })

    const warning = formatMissingDirectoriesWarning(report)
    expect(warning).toContain('/workspace/repos/demo')
    expect(warning).toContain('/workspace/repos/other')
    expect(warning).toContain('REPOSITORY DIRECTORY MISSING')
    expect(warning).toMatch(/error/)
  })

  it('still explains the repair when nothing is missing', () => {
    const warning = formatMissingDirectoriesWarning({
      checked: 0,
      markedMissing: [],
      markedRestored: [],
      unreadable: [],
      inFlight: 0,
    })
    expect(warning).toContain('REPOSITORY DIRECTORY MISSING')
  })
})
