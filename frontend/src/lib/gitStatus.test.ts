import { describe, it, expect } from 'vitest'
import { withStagedPaths, withoutPaths } from './gitStatus'
import type { GitStatusResponse } from '@/types/git'

const a = { path: 'a.txt', status: 'modified' as const, staged: false }
const b = { path: 'b.txt', status: 'modified' as const, staged: true }
const c = { path: 'c.txt', status: 'untracked' as const, staged: false }

const status = (files: GitStatusResponse['files']): GitStatusResponse => ({
  branch: 'main',
  ahead: 2,
  behind: 1,
  files,
  hasChanges: files.length > 0,
})

const stagedPaths = (s: GitStatusResponse) => s.files.filter((f) => f.staged).map((f) => f.path)

describe('withStagedPaths', () => {
  it('moves only the paths the user picked', () => {
    const result = withStagedPaths(status([a, b, c]), ['a.txt', 'c.txt'], true)
    expect(stagedPaths(result)).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })

  it('moves them back the other way', () => {
    const result = withStagedPaths(status([a, b]), ['b.txt'], false)
    expect(stagedPaths(result)).toEqual([])
  })

  it('leaves the rest of the status alone', () => {
    const before = status([a, b])
    const after = withStagedPaths(before, ['a.txt'], true)
    expect(after.branch).toBe(before.branch)
    expect(after.ahead).toBe(before.ahead)
    expect(after.behind).toBe(before.behind)
  })

  it('does not copy files it did not touch', () => {
    const before = status([a, b])
    const after = withStagedPaths(before, ['a.txt'], true)
    // b was already staged and is unchanged, so it can keep its identity and
    // every memo downstream of it can skip the re-render
    expect(after.files[1]).toBe(b)
    expect(after.files[0]).not.toBe(a)
  })

  it('returns the very same object when nothing would change', () => {
    const before = status([a, b])
    expect(withStagedPaths(before, ['b.txt'], true)).toBe(before)
    expect(withStagedPaths(before, [], true)).toBe(before)
    expect(withStagedPaths(before, ['nope.txt'], true)).toBe(before)
  })
})

describe('withoutPaths', () => {
  it('drops the discarded files entirely', () => {
    const result = withoutPaths(status([a, b, c]), ['a.txt', 'b.txt'])
    expect(result.files.map((f) => f.path)).toEqual(['c.txt'])
  })

  it('flips hasChanges once the list is empty', () => {
    const before = status([a, b])
    expect(before.hasChanges).toBe(true)
    const after = withoutPaths(before, ['a.txt', 'b.txt'])
    expect(after.files).toEqual([])
    expect(after.hasChanges).toBe(false)
  })

  it('keeps hasChanges true while anything is left', () => {
    const after = withoutPaths(status([a, b, c]), ['a.txt'])
    expect(after.hasChanges).toBe(true)
  })

  it('returns the very same object when there is nothing to drop', () => {
    const before = status([a, b])
    expect(withoutPaths(before, [])).toBe(before)
    expect(withoutPaths(before, ['nope.txt'])).toBe(before)
  })
})
