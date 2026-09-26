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
})
