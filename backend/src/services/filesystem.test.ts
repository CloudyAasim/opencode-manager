import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { browseDirectory } from './filesystem'

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-browse-'))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('browseDirectory', () => {
  it('lists only directories at the browse root and marks the root', async () => {
    await fs.mkdir(path.join(tmpRoot, 'projects'))
    await fs.mkdir(path.join(tmpRoot, 'archive'))
    await fs.writeFile(path.join(tmpRoot, 'readme.txt'), 'ignored file')

    const result = await browseDirectory(undefined, tmpRoot)

    expect(result.isRoot).toBe(true)
    expect(result.parentPath).toBeNull()
    expect(result.path).toBe(path.resolve(tmpRoot))
    expect(result.entries.map((e) => e.name)).toEqual(['archive', 'projects'])
  })

  it('marks git repositories', async () => {
    const repoDir = path.join(tmpRoot, 'my-repo')
    await fs.mkdir(repoDir)
    await fs.mkdir(path.join(repoDir, '.git'))
    await fs.mkdir(path.join(tmpRoot, 'plain'))

    const result = await browseDirectory(undefined, tmpRoot)

    const repo = result.entries.find((e) => e.name === 'my-repo')
    const plain = result.entries.find((e) => e.name === 'plain')
    expect(repo?.isGitRepo).toBe(true)
    expect(plain?.isGitRepo).toBe(false)
  })

  it('ignores hidden directories', async () => {
    await fs.mkdir(path.join(tmpRoot, '.hidden'))
    await fs.mkdir(path.join(tmpRoot, 'visible'))

    const result = await browseDirectory(undefined, tmpRoot)

    expect(result.entries.map((e) => e.name)).toEqual(['visible'])
  })

  it('navigates into a subdirectory and exposes the parent path', async () => {
    const sub = path.join(tmpRoot, 'level1')
    await fs.mkdir(sub)
    await fs.mkdir(path.join(sub, 'level2'))

    const result = await browseDirectory(sub, tmpRoot)

    expect(result.isRoot).toBe(false)
    expect(result.parentPath).toBe(path.resolve(tmpRoot))
    expect(result.entries.map((e) => e.name)).toEqual(['level2'])
  })

  it('rejects paths outside the browse root with 403', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-outside-'))
    try {
      await expect(browseDirectory(outside, tmpRoot)).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects traversal above the root with 403', async () => {
    await expect(browseDirectory(path.join(tmpRoot, '..'), tmpRoot)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a symlink inside the root that escapes the root with 403', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-outside-'))
    try {
      const linkPath = path.join(tmpRoot, 'escape-link')
      await fs.symlink(outside, linkPath)

      await expect(browseDirectory(linkPath, tmpRoot)).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('returns 404 for a non-existent directory', async () => {
    await expect(browseDirectory(path.join(tmpRoot, 'nope'), tmpRoot)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the path is a file', async () => {
    const filePath = path.join(tmpRoot, 'file.txt')
    await fs.writeFile(filePath, 'data')

    await expect(browseDirectory(filePath, tmpRoot)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 501 when the browse root is not configured', async () => {
    await expect(browseDirectory(undefined, '')).rejects.toMatchObject({ statusCode: 501 })
  })
})
