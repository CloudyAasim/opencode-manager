import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { migrate } from '../../../src/db/migration-runner'
import { allMigrations } from '../../../src/db/migrations'
import { SettingsService } from '../../../src/services/settings'
import { createInternalGitCredentialsRoutes } from '../../../src/routes/internal/git-credentials'
import { createRepo } from '../../../src/db/queries'
import type { GitCredential } from '@opencode-manager/shared'

/**
 * `GET /gh-env` answers with a GitHub token in plaintext - it is the
 * environment `gh` runs in.
 *
 * It took no identity, so `settingsOwnerId` fell back to `'default'`, the
 * server-global namespace. And `?cwd=` resolves a repository through
 * `getRepoByDirectory`, which lists every repository without an owner filter,
 * so naming another tenant's directory selected their namespace.
 *
 * These tests used to mount the route with no identity at all and write to the
 * `default` namespace, then assert the token came back - which is the defect,
 * stated as the expectation.
 */

const GITHUB_PAT: GitCredential = {
  name: 'github',
  host: 'github.com',
  type: 'pat',
  token: 'ghp_owner_token',
} as GitCredential

let db: Database
let settingsService: SettingsService
let app: Hono

/** The routes as the server mounts them: behind the token middleware. */
function appAs(userId: string | null): Hono {
  const bare = new Hono()
  bare.use('/*', async (c, next) => {
    if (userId) c.set('user' as never, { id: userId, role: 'user', username: userId } as never)
    await next()
  })
  bare.route('/', createInternalGitCredentialsRoutes(db))
  return bare
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db, allMigrations)
  settingsService = new SettingsService(db)
  app = appAs('u-owner')
})

describe('internal git-credentials /gh-env', () => {
  it('answers with the calling account\'s own GitHub credential', async () => {
    settingsService.updateSettings({ gitCredentials: [GITHUB_PAT] }, 'u-owner')

    const res = await app.request('/gh-env')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      GH_TOKEN: 'ghp_owner_token',
      GITHUB_TOKEN: 'ghp_owner_token',
    })
  })

  it('answers empty when the calling account has no GitHub credential', async () => {
    settingsService.updateSettings({ gitCredentials: [GITHUB_PAT] }, 'u-someone-else')

    const res = await appAs('u-stranger').request('/gh-env')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('does not read the server-global namespace', async () => {
    // `default` is where credentials written without an owner land - the
    // OpenCode server's own environment. It is not a namespace any tenant may
    // read, however it asks.
    settingsService.updateSettings({ gitCredentials: [GITHUB_PAT] })

    const res = await app.request('/gh-env')

    expect(await res.json()).toEqual({})
  })

  it('does not hand over another tenant\'s credential through ?cwd=', async () => {
    // `getRepoByDirectory` lists every repository with no owner filter, so
    // naming the other account's directory used to select their namespace -
    // their token, in plaintext, to anyone holding a token.
    settingsService.updateSettings({ gitCredentials: [GITHUB_PAT] }, 'u-victim')
    const victimRepo = createRepo(db, {
      repoUrl: 'https://github.com/victim/secret.git',
      localPath: 'victim-secret',
      sourcePath: join('/workspace/u-victim', 'victim-secret'),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 1,
      userId: 'u-victim',
    } as never)

    const res = await app.request(`/gh-env?cwd=${encodeURIComponent(victimRepo.fullPath)}`)

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body)).toEqual({})
    expect(body).not.toContain('ghp_owner_token')
  })

  it('still answers the owner\'s own credential when they name their own directory', async () => {
    settingsService.updateSettings({ gitCredentials: [GITHUB_PAT] }, 'u-owner')
    const ownRepo = createRepo(db, {
      repoUrl: 'https://github.com/owner/mine.git',
      localPath: 'mine',
      sourcePath: join('/workspace/u-owner', 'mine'),
      branch: 'main',
      defaultBranch: 'main',
      cloneStatus: 'ready',
      clonedAt: 1,
      userId: 'u-owner',
    } as never)

    const res = await app.request(`/gh-env?cwd=${encodeURIComponent(ownRepo.fullPath)}`)

    expect(await res.json()).toEqual({ GH_TOKEN: 'ghp_owner_token', GITHUB_TOKEN: 'ghp_owner_token' })
  })

  it('refuses when no caller is attributed', async () => {
    // Mounted without a middleware, so nothing places the request on a person.
    const bare = new Hono()
    bare.route('/', createInternalGitCredentialsRoutes(db))
    settingsService.updateSettings({ gitCredentials: [GITHUB_PAT] }, 'u-owner')

    const res = await bare.request('/gh-env')

    expect(res.status).toBe(401)
  })
})
