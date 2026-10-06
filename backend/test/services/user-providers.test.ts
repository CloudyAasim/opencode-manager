import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { UserProviderService } from '../../src/services/user-providers'

let workspace: string
const originalWorkspace = process.env.WORKSPACE_PATH

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-providers-'))
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

describe('UserProviderService', () => {
  it('stores provider credentials per user without leaking across users', async () => {
    const service = new UserProviderService()

    await service.set('alice', 'anthropic', 'alice-key')
    await service.set('bob', 'openai', 'bob-key')

    expect(await service.list('alice')).toEqual(['anthropic'])
    expect(await service.list('bob')).toEqual(['openai'])
    expect(await service.has('alice', 'openai')).toBe(false)

    const aliceConfig = JSON.parse(
      await fs.readFile(path.join(workspace, 'users', 'alice', 'setting', 'opencode.json'), 'utf-8'),
    ) as { provider: Record<string, { options: { apiKey: string } }> }
    expect(aliceConfig.provider.anthropic?.options.apiKey).toBe('alice-key')

    await service.delete('alice', 'anthropic')
    expect(await service.list('alice')).toEqual([])
    expect(await service.list('bob')).toEqual(['openai'])
  })

  it('keeps the rest of a provider entry when the credential is removed', async () => {
    const service = new UserProviderService()
    const configPath = path.join(workspace, 'users', 'alice', 'setting', 'opencode.json')

    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(
      configPath,
      JSON.stringify({
        model: 'relay/some-model',
        provider: {
          relay: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Relay',
            models: { 'some-model': { name: 'Some' } },
            options: { baseURL: 'https://relay.example/v1', apiKey: 'old-key', timeout: 30 },
          },
          untouched: { npm: '@ai-sdk/anthropic' },
        },
      }),
    )

    await service.delete('alice', 'relay')

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      model: string
      provider: Record<string, { npm?: string; name?: string; models?: unknown; options?: Record<string, unknown> }>
    }

    expect(config.model).toBe('relay/some-model')
    expect(config.provider.relay?.npm).toBe('@ai-sdk/openai-compatible')
    expect(config.provider.relay?.name).toBe('Relay')
    expect(config.provider.relay?.models).toEqual({ 'some-model': { name: 'Some' } })
    expect(config.provider.relay?.options).toEqual({ baseURL: 'https://relay.example/v1', timeout: 30 })
    expect(config.provider.relay?.options?.apiKey).toBeUndefined()
    expect(config.provider.untouched?.npm).toBe('@ai-sdk/anthropic')
    expect(await service.list('alice')).toEqual([])
  })

  it('drops the entry entirely when the credential was all it held', async () => {
    const service = new UserProviderService()
    const configPath = path.join(workspace, 'users', 'alice', 'setting', 'opencode.json')

    await service.set('alice', 'relay', 'alice-key')
    await service.delete('alice', 'relay')

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      provider: Record<string, unknown>
    }
    expect(config.provider.relay).toBeUndefined()
  })

  it('leaves a repository own declaration intact when the credential is removed', async () => {
    const service = new UserProviderService()
    const repoConfig = path.join(workspace, 'users', 'alice', 'workspace', 'repos', 'relay-ab', 'opencode.json')

    await fs.mkdir(path.dirname(repoConfig), { recursive: true })
    await fs.writeFile(
      repoConfig,
      JSON.stringify({
        provider: {
          'relay-ab': {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'https://committed.example/v1', apiKey: 'committed-key' },
          },
        },
      }),
    )

    await service.set('alice', 'relay-ab', 'alice-key')
    await service.delete('alice', 'relay-ab')

    const config = JSON.parse(await fs.readFile(repoConfig, 'utf-8')) as {
      provider: Record<string, { npm?: string; options?: Record<string, unknown> }>
    }
    expect(config.provider['relay-ab']?.npm).toBe('@ai-sdk/openai-compatible')
    expect(config.provider['relay-ab']?.options).toEqual({ baseURL: 'https://committed.example/v1' })
    expect(config.provider['relay-ab']?.options?.apiKey).toBeUndefined()
  })

  it('does not resurrect a provider whose credential was removed everywhere', async () => {
    const service = new UserProviderService()

    await service.set('alice', 'relay-ab', 'alice-key')
    expect(await service.list('alice')).toEqual(['relay-ab'])

    await service.delete('alice', 'relay-ab')
    expect(await service.list('alice')).toEqual([])
    expect(await service.has('alice', 'relay-ab')).toBe(false)
  })

  it('removes a provider entry that is not an object instead of spreading it', async () => {
    const service = new UserProviderService()
    const configPath = path.join(workspace, 'users', 'alice', 'setting', 'opencode.json')

    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify({ model: 'x/y', provider: { relay: 'not-an-object' } }))

    await service.delete('alice', 'relay')

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      model: string
      provider: Record<string, unknown>
    }
    expect(config.model).toBe('x/y')
    expect(config.provider.relay).toBeUndefined()
  })

  it('leaves an array entry alone in shape while removing the credential', async () => {
    const service = new UserProviderService()
    const configPath = path.join(workspace, 'users', 'alice', 'setting', 'opencode.json')

    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, JSON.stringify({ provider: { relay: ['a', 'b'] } }))

    await service.delete('alice', 'relay')

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      provider: Record<string, unknown>
    }
    expect(config.provider.relay).toBeUndefined()
  })
})
