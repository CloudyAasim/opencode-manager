import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { createProvidersRoutes } from '../../src/routes/providers'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import { migrate } from '../../src/db/migration-runner'
import { allMigrations } from '../../src/db/migrations'
import { runWithAccessScope, type AccessScope } from '../../src/auth/access-scope'

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const paths = vi.hoisted(() => ({ config: '', configDir: '' }))
vi.mock('@opencode-manager/shared/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opencode-manager/shared/config/env')>()
  return {
    ...actual,
    getConfigPath: () => paths.configDir,
    getOpenCodeConfigFilePath: () => paths.config,
    getUsersWorkspacePath: () => path.join(paths.configDir, 'users'),
    getUserWorkspacePath: (username: string) => path.join(paths.configDir, 'users', username, 'workspace'),
    getUserSettingPath: (username: string) => path.join(paths.configDir, 'users', username, 'setting'),
    getUserReposPath: (username: string) => path.join(paths.configDir, 'users', username, 'workspace', 'repos'),
    OPENCODE_CONFIG_SOURCE_NAMES: ['config.json', 'opencode.json', 'opencode.jsonc'],
  }
})

let workspace: string
let db: Database
let app: Hono

function scope(username: string): AccessScope {
  const base = path.join(workspace, 'users', username)
  return {
    roots: [path.join(base, 'workspace'), path.join(base, 'setting')],
    browseRoot: path.join(base, 'workspace'),
    repoBase: path.join(base, 'workspace', 'repos'),
    username,
  }
}

function as(username: string, fn: () => Promise<Response>): Promise<Response> {
  return Promise.resolve(runWithAccessScope(scope(username), fn))
}

function settingConfig(username: string): Promise<Record<string, Record<string, unknown>>> {
  return fs
    .readFile(path.join(workspace, 'users', username, 'setting', 'opencode.json'), 'utf-8')
    .then((raw) => (JSON.parse(raw) as { provider: Record<string, Record<string, unknown>> }).provider)
}

beforeEach(async () => {
  vi.clearAllMocks()
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-decl-routes-'))
  paths.configDir = workspace
  paths.config = path.join(workspace, 'opencode.jsonc')
  db = new Database(':memory:')
  migrate(db, allMigrations)
  app = new Hono()
  app.route('/providers', createProvidersRoutes(createStubOpenCodeClient(), undefined, db))
})

afterEach(async () => {
  db.close()
  await fs.rm(workspace, { recursive: true, force: true })
})

async function declare(username: string, providerId: string, entry: Record<string, unknown>): Promise<Response> {
  return as(username, async () =>
    app.request('/providers/declarations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, entry }),
    }),
  )
}

describe('provider declarations over HTTP', () => {
  it('refuses a request that carries no tenant', async () => {
    // No scope installed, so there is no tenant to write for. Writing anyway
    // would need an invented owner, and an invented owner is how a declaration
    // ends up in a stranger's directory.
    const res = await app.request('/providers/declarations')
    expect(res.status).toBe(401)
  })

  it('writes a declaration for the caller and no other', async () => {
    await fs.mkdir(path.join(workspace, 'users', 'bob', 'setting'), { recursive: true })

    expect((await declare('alice', 'acme', { name: 'Acme' })).status).toBe(200)

    expect((await settingConfig('alice')).acme).toEqual({ name: 'Acme' })
    await expect(settingConfig('bob')).rejects.toThrow()
  })

  it('gives two tenants the same id independently', async () => {
    await declare('alice', 'acme', { name: 'Alice Acme', options: { baseURL: 'https://alice.test' } })
    await declare('bob', 'acme', { name: 'Bob Acme', options: { baseURL: 'https://bob.test' } })

    expect((await settingConfig('alice')).acme).toMatchObject({ name: 'Alice Acme' })
    expect((await settingConfig('bob')).acme).toMatchObject({ name: 'Bob Acme' })
  })

  it('refuses a provider id that is not lowercase, digits and dashes', async () => {
    const res = await declare('alice', 'Acme Corp', { name: 'x' })

    expect(res.status).toBe(400)
    await expect(settingConfig('alice')).rejects.toThrow()
  })

  it('accepts any provider entry shape but never one carrying a whole configuration', async () => {
    // The schema is a record under a single key. There is no request that can
    // put `model`, `permission`, `agent`, `mcp` or `plugin` next to it, so the
    // tenant path cannot reach anything but their own providers.
    const res = await declare('alice', 'acme', {
      name: 'Acme',
      models: { 'gpt-4o': { limit: { context: 128000 } } },
      npm: '@ai-sdk/openai-compatible',
    })

    expect(res.status).toBe(200)
    const entry = (await settingConfig('alice')).acme as Record<string, unknown>
    expect(Object.keys(entry).sort()).toEqual(['models', 'name', 'npm'])
  })

  it('lists back exactly what was written', async () => {
    await declare('alice', 'acme', { name: 'Acme', options: { baseURL: 'https://acme.test' } })

    const res = await as('alice', async () => app.request('/providers/declarations'))
    const body = (await res.json()) as { declarations: Record<string, unknown>; conflicts: unknown[] }

    expect(body.declarations.acme).toMatchObject({ name: 'Acme' })
    expect(body.conflicts).toEqual([])
  })

  it('removes a declaration for the caller only', async () => {
    await declare('alice', 'acme', { name: 'Acme' })
    await declare('bob', 'acme', { name: 'Acme' })

    const res = await as('alice', async () => app.request('/providers/declarations/acme', { method: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(await settingConfig('alice')).toEqual({})
    expect((await settingConfig('bob')).acme).toBeTruthy()
  })

  it('records the tenant in the audit log, scoped to them', async () => {
    await declare('alice', 'acme', { name: 'Acme' })

    const row = db
      .prepare('SELECT scope, subject, changed_keys, details FROM opencode_config_audit')
      .get() as { scope: string; subject: string; changed_keys: string; details: string }

    expect(row.scope).toBe('user')
    // "Who was affected" is one person here, not the server. That is the whole
    // difference from a global write in the same table.
    expect(row.subject).toBe('alice')
    expect(row.changed_keys).toBe('["provider"]')
    expect(JSON.parse(row.details)).toMatchObject({
      action: 'declare',
      provider: { added: ['acme'], removed: [] },
    })
  })
})
