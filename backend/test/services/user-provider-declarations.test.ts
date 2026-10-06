import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UserProviderService } from '../../src/services/user-providers'

let workspace: string
const originalWorkspace = process.env.WORKSPACE_PATH

function settingDir(username: string): string {
  return path.join(workspace, 'users', username, 'setting')
}

function repoDir(username: string, name: string): string {
  return path.join(workspace, 'users', username, 'workspace', 'repos', name)
}

async function readConfig(dir: string): Promise<Record<string, Record<string, unknown>>> {
  const raw = await fs.readFile(path.join(dir, 'opencode.json'), 'utf-8')
  return (JSON.parse(raw) as { provider: Record<string, Record<string, unknown>> }).provider
}

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-declarations-'))
  process.env.WORKSPACE_PATH = workspace
})

afterEach(async () => {
  if (originalWorkspace === undefined) {
    delete process.env.WORKSPACE_PATH
  } else {
    process.env.WORKSPACE_PATH = originalWorkspace
  }
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('UserProviderService declarations', () => {
  it('writes a declaration into every repository the tenant has, and into no one else\'s', async () => {
    const service = new UserProviderService()
    await fs.mkdir(repoDir('alice', 'one'), { recursive: true })
    await fs.mkdir(repoDir('alice', 'two'), { recursive: true })
    await fs.mkdir(repoDir('bob', 'one'), { recursive: true })

    await service.declare('alice', 'acme', { name: 'Acme', options: { baseURL: 'https://acme.test' } })

    for (const dir of [repoDir('alice', 'one'), repoDir('alice', 'two')]) {
      expect((await readConfig(dir)).acme).toMatchObject({ options: { baseURL: 'https://acme.test' } })
    }
    // The whole point of the split: Bob's checkout is a different file and
    // must not have learned anything about Alice's provider.
    await expect(readConfig(repoDir('bob', 'one'))).rejects.toThrow()
  })

  it('gives two tenants the same id without either one clobbering the other', async () => {
    const service = new UserProviderService()
    await fs.mkdir(repoDir('alice', 'proj'), { recursive: true })
    await fs.mkdir(repoDir('bob', 'proj'), { recursive: true })

    await service.declare('alice', 'acme', { options: { baseURL: 'https://alice.test' } })
    await service.declare('bob', 'acme', { options: { baseURL: 'https://bob.test' } })

    expect((await readConfig(repoDir('alice', 'proj'))).acme)
      .toMatchObject({ options: { baseURL: 'https://alice.test' } })
    expect((await readConfig(repoDir('bob', 'proj'))).acme)
      .toMatchObject({ options: { baseURL: 'https://bob.test' } })
  })

  it('keeps the keys and any other keys of the provider it is describing', async () => {
    const service = new UserProviderService()
    await service.set('alice', 'acme', 'alice-key')

    await service.declare('alice', 'acme', { name: 'Acme' })

    const entry = (await service.declarations('alice')).acme
    expect(entry?.name).toBe('Acme')
    // Describing a provider again must not be a way to lose the key that was
    // attached to it, or the models the dialog does not own.
    expect((entry?.options as { apiKey?: string } | undefined)?.apiKey).toBe('alice-key')
  })

  it('removes a declaration and leaves the other providers alone', async () => {
    const service = new UserProviderService()
    await service.declare('alice', 'acme', { name: 'Acme' })
    await service.declare('alice', 'keep', { name: 'Keep' })

    await service.undeclare('alice', 'acme')

    const remaining = await service.declarations('alice')
    expect(Object.keys(remaining)).toEqual(['keep'])
  })

  it('removes the declaration from every repository, not only the one it is read from', async () => {
    const service = new UserProviderService()
    await fs.mkdir(repoDir('alice', 'one'), { recursive: true })
    await fs.mkdir(repoDir('alice', 'two'), { recursive: true })
    await service.declare('alice', 'acme', { name: 'Acme' })
    await service.declare('alice', 'keep', { name: 'Keep' })

    await service.undeclare('alice', 'acme')

    // `setting/` is the first directory in the list and the only one the
    // declaration is ever read back from, so a removal that stopped there would
    // look finished while every checkout still carried the provider.
    for (const dir of [repoDir('alice', 'one'), repoDir('alice', 'two')]) {
      const providers = await readConfig(dir)
      expect(Object.keys(providers)).toEqual(['keep'])
    }
  })

  it('reports nothing for a tenant who has declared nothing', async () => {
    expect(await new UserProviderService().declarations('nobody')).toEqual({})
  })

  it('replays the declaration into a repository that did not exist when it was made', async () => {
    const service = new UserProviderService()
    await service.declare('alice', 'acme', { name: 'Acme' })
    await service.set('alice', 'acme', 'alice-key')

    const late = repoDir('alice', 'late')
    await fs.mkdir(late, { recursive: true })
    // A repository created after the declaration starts with no config at all,
    // and a session in it would not see the provider.
    await expect(readConfig(late)).rejects.toThrow()

    await service.syncIntoRepo('alice', late)

    expect((await readConfig(late)).acme).toMatchObject({
      name: 'Acme',
      options: { apiKey: 'alice-key' },
    })
  })

  it('leaves the rest of a repository config file alone when replaying', async () => {
    const service = new UserProviderService()
    await service.declare('alice', 'acme', { name: 'Acme' })
    const dir = repoDir('alice', 'with-settings')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'opencode.json'),
      JSON.stringify({ theme: 'dark', model: 'x/y', provider: { local: { name: 'Local' } } }),
      'utf-8',
    )

    await service.syncIntoRepo('alice', dir)

    const raw = JSON.parse(await fs.readFile(path.join(dir, 'opencode.json'), 'utf-8')) as Record<string, unknown>
    expect(raw.theme).toBe('dark')
    expect(raw.model).toBe('x/y')
    expect((raw.provider as Record<string, unknown>).local).toEqual({ name: 'Local' })
    expect((raw.provider as Record<string, unknown>).acme).toBeTruthy()
  })

  it('writing the same declaration twice leaves the file alone the second time', async () => {
    const service = new UserProviderService()
    const dir = repoDir('alice', 'proj')
    await fs.mkdir(dir, { recursive: true })
    const configPath = path.join(dir, 'opencode.json')
    await service.declare('alice', 'acme', { name: 'Acme' })
    await service.syncIntoRepo('alice', dir)
    const first = await fs.readFile(configPath, 'utf-8')

    await service.syncIntoRepo('alice', dir)

    expect(await fs.readFile(configPath, 'utf-8')).toBe(first)
  })
})
