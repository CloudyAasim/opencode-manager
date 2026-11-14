import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import type { AuthInstance } from '../../auth'
import { FakeAgentProvider } from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import type { AgentDefaults, Command, WorkingMode } from '@opencode-manager/shared/api/v1'

function authThatFinds(session: unknown): AuthInstance {
  return {
    api: { getSession: async () => session },
  } as unknown as AuthInstance
}

const asAdmin = authThatFinds({
  session: { id: 'session-1', userId: 'user-1' },
  user: {
    id: 'user-1',
    name: 'user',
    username: 'user-1',
    email: 'user@example.com',
    role: 'admin',
  },
})
const asSomebodyElse = authThatFinds({
  session: { id: 'session-2', userId: 'user-2' },
  user: {
    id: 'user-2',
    name: 'other',
    username: 'user-2',
    email: 'other@example.com',
    role: 'user',
  },
})

let database: Database
let workspace: string
let previousWorkspacePath: string | undefined

/** The working directory that belongs to the person calling. */
function ownDirectory(): string {
  return path.join(workspace, 'users', 'user-2', 'workspace')
}

/** The working directory that belongs to somebody else. */
function otherDirectory(): string {
  return path.join(workspace, 'users', 'user-1', 'workspace')
}

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-face-'))
  previousWorkspacePath = process.env.WORKSPACE_PATH
  process.env.WORKSPACE_PATH = workspace
  database = new Database(':memory:')
  migrate(database, allMigrations)
})

afterAll(async () => {
  database.close()
  if (previousWorkspacePath === undefined) {
    delete process.env.WORKSPACE_PATH
  } else {
    process.env.WORKSPACE_PATH = previousWorkspacePath
  }
  await rm(workspace, { recursive: true, force: true })
})

function createApp(
  providers: FakeAgentProvider[],
  auth: AuthInstance = asAdmin,
): { app: Hono; registry: ProviderRegistry } {
  const registry = new ProviderRegistry()
  for (const provider of providers) registry.register(provider, { default: true })
  const app = new Hono()
  app.route('/api/bff', createBffRoutes(registry, database, { auth }))
  return { app, registry }
}

function json(res: Response): Promise<{
  error?: { code: string }
  commands?: Command[]
  workingModes?: WorkingMode[]
  defaults?: AgentDefaults
}> {
  return res.json() as Promise<{
    error?: { code: string }
    commands?: Command[]
    workingModes?: WorkingMode[]
    defaults?: AgentDefaults
  }>
}

describe('这一层出的 agent 自己那张脸', () => {
  it('命令问一次，出来的就是版本化的方言', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      commands: [
        {
          name: 'init',
          description: 'start the project',
          workingMode: 'build',
          model: { providerId: 'anthropic', modelId: 'claude' },
          template: 'set up the project',
          subtask: false,
          hints: ['repository'],
        },
      ],
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(`/api/bff/commands?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.commands).toEqual([
      {
        name: 'init',
        description: 'start the project',
        workingMode: 'build',
        model: { providerId: 'anthropic', modelId: 'claude' },
        template: 'set up the project',
        subtask: false,
        hints: ['repository'],
      },
    ])

    const asked = provider.calls.find((call) => call.method === 'listCommands')
    expect(asked?.context?.directory).toBe(own)
  })

  it('没点名目录，问的是 agent 自己的命令', async () => {
    const provider = new FakeAgentProvider({ commands: [] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/commands')

    expect(res.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'listCommands')
    expect(asked?.context?.directory).toBeUndefined()
  })

  it('不是自己的目录，命令不给问', async () => {
    const provider = new FakeAgentProvider({ commands: [] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/commands?directories=${encodeURIComponent(otherDirectory())}`,
    )

    expect(res.status).toBe(403)
    const body = await json(res)
    expect(body.error?.code).toBe('forbidden')
    expect(provider.calls.some((call) => call.method === 'listCommands')).toBe(false)
  })

  it('工作方式问一次，出来的就是版本化的方言', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      workingModes: [
        {
          name: 'build',
          description: 'writes the code',
          scope: 'all',
          hidden: false,
          color: '#ff0000',
          model: { providerId: 'anthropic', modelId: 'claude' },
        },
        {
          name: 'review',
          description: 'reads the code',
          scope: 'subagent',
          hidden: true,
          color: null,
          model: null,
        },
      ],
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(`/api/bff/working-modes?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.workingModes).toHaveLength(2)
    expect(body.workingModes?.[0]).toEqual({
      name: 'build',
      description: 'writes the code',
      scope: 'all',
      hidden: false,
      color: '#ff0000',
      model: { providerId: 'anthropic', modelId: 'claude' },
    })

    const asked = provider.calls.find((call) => call.method === 'listWorkingModes')
    expect(asked?.context?.directory).toBe(own)
  })

  it('不是自己的目录，工作方式不给问', async () => {
    const provider = new FakeAgentProvider({ workingModes: [] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/working-modes?directories=${encodeURIComponent(otherDirectory())}`,
    )

    expect(res.status).toBe(403)
    expect(provider.calls.some((call) => call.method === 'listWorkingModes')).toBe(false)
  })

  it('默认值只给两个，别的配置不翻', async () => {
    const own = ownDirectory()
    const provider = new FakeAgentProvider({
      defaults: { model: { providerId: 'anthropic', modelId: 'claude' }, workingMode: 'build' },
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request(`/api/bff/defaults?directories=${encodeURIComponent(own)}`)

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.defaults).toEqual({
      model: { providerId: 'anthropic', modelId: 'claude' },
      workingMode: 'build',
    })

    const asked = provider.calls.find((call) => call.method === 'getDefaults')
    expect(asked?.context?.directory).toBe(own)
  })

  it('不是自己的目录，默认值不给问', async () => {
    const provider = new FakeAgentProvider({ defaults: { model: null, workingMode: null } })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request(
      `/api/bff/defaults?directories=${encodeURIComponent(otherDirectory())}`,
    )

    expect(res.status).toBe(403)
    expect(provider.calls.some((call) => call.method === 'getDefaults')).toBe(false)
  })
})
