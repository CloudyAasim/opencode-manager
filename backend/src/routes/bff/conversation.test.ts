import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBffRoutes } from './index'
import { ProviderRegistry } from '../../providers/registry'
import type { AuthInstance } from '../../auth'
import {
  FakeAgentProvider,
  makeMessage,
  makeSession,
} from '../../../test/helpers/fake-agent-provider'
import { migrate } from '../../db/migration-runner'
import { allMigrations } from '../../db/migrations'
import { recordAgentSession } from '../../services/agent-session'
import type { MessageWithParts, Session } from '@opencode-manager/shared/api/v1'

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

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'bff-conversation-'))
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

function directoryOf(call: { context?: { directory?: string } } | undefined): string | undefined {
  return call?.context?.directory
}

function json(res: Response): Promise<{ error?: { code: string }; messages?: MessageWithParts[] }> {
  return res.json() as Promise<{
    error?: { code: string }
    messages?: MessageWithParts[]
  }>
}

describe('这一层出的对话', () => {
  beforeEach(() => {
    // The ledger is shared by the whole file, and a row left behind by one
    // test would decide another one's answer.
    database.prepare('DELETE FROM ocm_agent_session').run()
  })

  it('读消息要问到会话在哪儿', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-1', directory: own })],
      messages: { 'ses-1': [makeMessage()] },
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/messages')

    expect(res.status).toBe(200)
    const asked = provider.calls.find((call) => call.method === 'listMessages')
    expect(directoryOf(asked)).toBe(own)
  })

  it('消息是版本化的方言：一条消息和它的部件', async () => {
    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-1' })],
      messages: { 'ses-1': [makeMessage({ id: 'msg-1', role: 'assistant' })] },
    })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-1/messages')

    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.messages).toHaveLength(1)
    expect(body.messages?.[0]?.info.id).toBe('msg-1')
    expect(body.messages?.[0]?.info.sessionId).toBe('session-1')
    expect(body.messages?.[0]?.parts[0]).toEqual({
      id: 'part-1',
      type: 'text',
      text: 'hello',
      synthetic: null,
      time: null,
    })
  })

  it('agent 不认识的会话，读不到消息', async () => {
    const provider = new FakeAgentProvider({ sessions: [] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-nope/messages')

    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body.error?.code).toBe('not_found')
    expect(provider.calls.some((call) => call.method === 'listMessages')).toBe(false)
  })

  it('别人的会话，读不到消息', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
      messages: { 'ses-theirs': [makeMessage()] },
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/messages')

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'listMessages')).toBe(false)
  })

  it('发提示要问到会话在哪儿，提示也照原样送到', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [
          { type: 'text', text: 'do it' },
          { type: 'file', filename: 'note.txt', mime: 'text/plain', url: 'file:///tmp/note.txt' },
        ],
        model: { providerId: 'anthropic', modelId: 'claude' },
        agent: 'build',
        variant: null,
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { accepted: boolean }
    expect(body).toEqual({ accepted: true })

    const sent = provider.calls.find((call) => call.method === 'sendPrompt')
    expect(directoryOf(sent)).toBe(own)
    expect(sent?.args[1]).toEqual({
      parts: [
        { type: 'text', text: 'do it' },
        { type: 'file', filename: 'note.txt', mime: 'text/plain', url: 'file:///tmp/note.txt' },
      ],
      model: { providerId: 'anthropic', modelId: 'claude' },
      agent: 'build',
      variant: null,
    })
  })

  it('提示的请求体不合契约，就不该发出去', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1' })] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'do it' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'sendPrompt')).toBe(false)
  })

  it('别人的会话，提示发不出去', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parts: [{ type: 'text', text: 'do it' }],
        model: null,
        agent: null,
        variant: null,
      }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'sendPrompt')).toBe(false)
  })

  it('回退要问到会话在哪儿，回退到哪一条也要说清楚', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'msg-1', partId: null }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: Session }
    expect(body.session.revert).toEqual({ messageId: 'msg-1', partId: null })

    const reverted = provider.calls.find((call) => call.method === 'revertSession')
    expect(directoryOf(reverted)).toBe(own)
    expect(reverted?.args[1]).toEqual({ messageId: 'msg-1', partId: null })
  })

  it('别人的会话，不该被回退', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'msg-1', partId: null }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'revertSession')).toBe(false)
  })

  it('权限的应答要问到会话在哪儿，应答本身也要说清楚', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/permissions/per-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'once' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { accepted: boolean }
    expect(body).toEqual({ accepted: true })

    const replied = provider.calls.find((call) => call.method === 'respondToPermission')
    expect(directoryOf(replied)).toBe(own)
    expect(replied?.args[0]).toBe('per-1')
    expect(replied?.args[1]).toBe('once')
  })

  it('权限的应答不合契约，就不该发出去', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1' })] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-1/permissions/per-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'maybe' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'respondToPermission')).toBe(false)
  })

  it('别人的会话，权限的应答发不出去', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/permissions/per-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: 'always' }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'respondToPermission')).toBe(false)
  })

  it('问题的应答要问到会话在哪儿，答案按问的顺序送到', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/questions/q-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [['first'], ['second', 'also second']] }),
    })

    expect(res.status).toBe(200)

    const replied = provider.calls.find((call) => call.method === 'replyToQuestion')
    expect(directoryOf(replied)).toBe(own)
    expect(replied?.args[0]).toBe('q-1')
    expect(replied?.args[1]).toEqual([['first'], ['second', 'also second']])
  })

  it('问题被拒掉，也要问到会话在哪儿', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/questions/q-1/reject', { method: 'POST' })

    expect(res.status).toBe(200)

    const rejected = provider.calls.find((call) => call.method === 'rejectQuestion')
    expect(directoryOf(rejected)).toBe(own)
    expect(rejected?.args[0]).toBe('q-1')
  })

  it('别人的会话，问题的应答发不出去', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/questions/q-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [['first']] }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'replyToQuestion')).toBe(false)
  })

  it('命令要问到会话在哪儿，命令也照原样送到', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'init',
        arguments: 'now',
        workingMode: 'build',
        model: { providerId: 'anthropic', modelId: 'claude' },
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { accepted: boolean }
    expect(body).toEqual({ accepted: true })

    const sent = provider.calls.find((call) => call.method === 'sendCommand')
    expect(directoryOf(sent)).toBe(own)
    expect(sent?.args[1]).toEqual({
      command: 'init',
      arguments: 'now',
      workingMode: 'build',
      model: { providerId: 'anthropic', modelId: 'claude' },
    })
  })

  it('命令的请求体不合契约，就不该发出去', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1' })] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-1/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '' }),
    })

    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error?.code).toBe('bad_request')
    expect(provider.calls.some((call) => call.method === 'sendCommand')).toBe(false)
  })

  it('别人的会话，命令发不出去', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'init',
        arguments: '',
        workingMode: null,
        model: null,
      }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'sendCommand')).toBe(false)
  })

  it('摘要要问到会话在哪儿，写摘要的模型也照原样送到', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: { providerId: 'anthropic', modelId: 'claude' } }),
    })

    expect(res.status).toBe(200)

    const sent = provider.calls.find((call) => call.method === 'summarizeSession')
    expect(directoryOf(sent)).toBe(own)
    expect(sent?.args[1]).toEqual({ providerId: 'anthropic', modelId: 'claude' })
  })

  it('摘要的请求体不合契约，就不该发出去', async () => {
    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1' })] })
    const { app } = createApp([provider], asAdmin)

    const res = await app.request('/api/bff/sessions/ses-1/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: null }),
    })

    expect(res.status).toBe(400)
    expect(provider.calls.some((call) => call.method === 'summarizeSession')).toBe(false)
  })

  it('拷出来的会话记到账上，记账的是要它的人', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'msg-1' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: Session }
    expect(body.session.id).toBe('ses-1-fork')

    const forked = provider.calls.find((call) => call.method === 'forkSession')
    expect(directoryOf(forked)).toBe(own)
    expect(forked?.args[1]).toEqual({ messageId: 'msg-1' })

    const row = database
      .prepare('SELECT session_id, user_id FROM ocm_agent_session WHERE session_id = ?')
      .get('ses-1-fork') as { session_id: string; user_id: string } | undefined
    expect(row?.user_id).toBe('user-2')
  })

  it('别人的会话，副本拷不出来', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: null }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'forkSession')).toBe(false)
  })

  it('shell 要问到会话在哪儿，命令也照原样送到', async () => {
    const own = ownDirectory()
    recordAgentSession(database, {
      sessionId: 'ses-1',
      userId: 'user-2',
      username: 'other',
      role: 'user',
      directory: own,
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({ sessions: [makeSession({ id: 'ses-1', directory: own })] })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-1/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'ls -la', workingMode: 'build' }),
    })

    expect(res.status).toBe(200)

    const sent = provider.calls.find((call) => call.method === 'sendShell')
    expect(directoryOf(sent)).toBe(own)
    expect(sent?.args[1]).toEqual({ command: 'ls -la', workingMode: 'build' })
  })

  it('别人的会话，shell 发不出去', async () => {
    recordAgentSession(database, {
      sessionId: 'ses-theirs',
      userId: 'user-1',
      username: 'user',
      role: 'admin',
      directory: ownDirectory(),
      source: 'proxy',
    })

    const provider = new FakeAgentProvider({
      sessions: [makeSession({ id: 'ses-theirs', directory: ownDirectory() })],
    })
    const { app } = createApp([provider], asSomebodyElse)

    const res = await app.request('/api/bff/sessions/ses-theirs/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'ls -la', workingMode: null }),
    })

    expect(res.status).toBe(404)
    expect(provider.calls.some((call) => call.method === 'sendShell')).toBe(false)
  })
})
