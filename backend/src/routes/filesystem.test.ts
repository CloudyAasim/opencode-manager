import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFilesystemRoutes } from './filesystem'
import { runWithAccessScope, type AccessScope } from '../auth/access-scope'

let tmpRoot: string
let app: Hono

async function scopedRequest(pathname: string, scope: AccessScope): Promise<Response> {
  return runWithAccessScope(scope, () => app.request(pathname))
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-fs-route-'))
  app = new Hono()
  app.route('/filesystem', createFilesystemRoutes())
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('GET /api/filesystem/browse', () => {
  it('returns the directory listing for the root', async () => {
    await fs.mkdir(path.join(tmpRoot, 'projects'))

    const res = await scopedRequest('/filesystem/browse', { roots: [tmpRoot], browseRoot: tmpRoot, repoBase: tmpRoot })
    expect(res.status).toBe(200)

    const body = await res.json() as { isRoot: boolean; entries: { name: string }[] }
    expect(body.isRoot).toBe(true)
    expect(body.entries.map((e) => e.name)).toEqual(['projects'])
  })

  it('returns 403 for a path outside the root', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-fs-outside-'))
    try {
      const res = await scopedRequest(
        `/filesystem/browse?path=${encodeURIComponent(outside)}`,
        { roots: [tmpRoot], browseRoot: tmpRoot, repoBase: tmpRoot },
      )
      expect(res.status).toBe(403)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('returns 404 for a missing directory', async () => {
    const res = await scopedRequest(
      `/filesystem/browse?path=${encodeURIComponent(path.join(tmpRoot, 'missing'))}`,
      { roots: [tmpRoot], browseRoot: tmpRoot, repoBase: tmpRoot },
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when the account has no browse root', async () => {
    const res = await scopedRequest('/filesystem/browse', { roots: [], browseRoot: '', repoBase: tmpRoot })
    expect(res.status).toBe(403)
  })

  // The containment check compares `realpath` on *both* sides, and that is the
  // only reason a symlink cannot be used to list another account's workspace.
  // It is easy to "simplify" into comparing the resolved paths instead, which
  // reads better and passes every other test here - so it is pinned directly.
  it('returns 403 for a symlink inside the root that points outside it', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-fs-link-target-'))
    try {
      await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours')

      const link = path.join(tmpRoot, 'innocent-looking')
      // A junction on Windows: a `dir` symlink needs Developer Mode or an
      // elevated shell there, and a junction resolves under `realpath`
      // exactly like the symlink it stands in for.
      await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

      const res = await scopedRequest(
        `/filesystem/browse?path=${encodeURIComponent(link)}`,
        { roots: [tmpRoot], browseRoot: tmpRoot, repoBase: tmpRoot },
      )

      expect(res.status).toBe(403)
      // Belt and braces: the listing must not have leaked either.
      expect(await res.text()).not.toContain('secret.txt')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('returns 403 for a sibling directory whose name shares the root prefix', async () => {
    // `/tmp/ocm-fs-abc` must not match `/tmp/ocm-fs-abc2`. A prefix string test
    // would let this through; a path-segment comparison does not.
    const sibling = `${tmpRoot}2`
    await fs.mkdir(sibling)
    try {
      const res = await scopedRequest(
        `/filesystem/browse?path=${encodeURIComponent(sibling)}`,
        { roots: [tmpRoot], browseRoot: tmpRoot, repoBase: sibling },
      )
      expect(res.status).toBe(403)
    } finally {
      await fs.rm(sibling, { recursive: true, force: true })
    }
  })

  it('reports the parent only below the root', async () => {
    const nested = path.join(tmpRoot, 'a', 'b')
    await fs.mkdir(nested, { recursive: true })

    const res = await scopedRequest(
      `/filesystem/browse?path=${encodeURIComponent(nested)}`,
      { roots: [tmpRoot], browseRoot: tmpRoot, repoBase: tmpRoot },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { isRoot: boolean; parentPath: string | null }
    expect(body.isRoot).toBe(false)
    expect(body.parentPath).toBe(path.join(tmpRoot, 'a'))
  })
})
