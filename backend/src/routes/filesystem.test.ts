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
})
