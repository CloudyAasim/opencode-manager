import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { spawn, spawnSync } from 'child_process'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import os from 'os'
import { pathToFileURL } from 'url'
import { ASSISTANT_NOTIFICATION_LIMITS, AssistantNotificationRequestSchema } from '@opencode-manager/shared/schemas'
import { MANAGER_TOOL_NAME, MANAGER_TOOL_ALLOWED_ROUTES, parseAllowedRoute } from '../../src/services/opencode-manager-tool-plugin'
import { installManagedPlugins, getOpenCodePluginDir } from '../../src/services/opencode/plugin-registry'

type ZodLike = { safeParse: (value: unknown) => { success: boolean } }

type ToolContext = { sessionID?: string; directory?: string } | undefined

type ToolDefinition = {
  description: string
  args: Record<string, ZodLike>
  execute: (args: unknown, context?: ToolContext) => Promise<string>
}

type PluginHooks = { tool: Record<string, ToolDefinition | undefined> }

async function loadTool(configHome: string): Promise<ToolDefinition> {
  const file = path.join(getOpenCodePluginDir(configHome), 'ocm-manager.js')
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`)
  const hooks = await (mod.default as () => Promise<PluginHooks>)()
  const tool = hooks.tool[MANAGER_TOOL_NAME]
  if (!tool) throw new Error(`The generated plugin does not register a "${MANAGER_TOOL_NAME}" tool`)
  return tool
}

function jsonResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
  })
}

describe('ocm-manager plugin', () => {
  let configHome: string

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-manager-'))
    await installManagedPlugins(configHome)
    process.env.OCM_INTERNAL_API_URL = 'http://localhost:5003/api/internal'
    process.env.OCM_INTERNAL_TOKEN = 'secret-token'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    await fs.rm(configHome, { recursive: true, force: true })
  })

  it('registers the manager tool with typed Zod args', async () => {
    const tool = await loadTool(configHome)

    expect(tool.description).toContain('send_notification')
    expect(tool.args.action?.safeParse('send_notification').success).toBe(true)
    expect(tool.args.action?.safeParse('drop_database').success).toBe(false)
    expect(tool.args.params?.safeParse({ title: 't', body: 'b' }).success).toBe(true)
    expect(tool.args.params?.safeParse({ title: 't', body: 'b', priority: 'urgent' }).success).toBe(false)
  })

  it('enforces the notification limits the internal API enforces', async () => {
    const tool = await loadTool(configHome)
    const withinLimits = { title: 'x'.repeat(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX), body: 'b' }
    const overLimit = { title: 'x'.repeat(ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX + 1), body: 'b' }

    expect(AssistantNotificationRequestSchema.safeParse(withinLimits).success).toBe(true)
    expect(tool.args.params?.safeParse(withinLimits).success).toBe(true)
    expect(AssistantNotificationRequestSchema.safeParse(overLimit).success).toBe(false)
    expect(tool.args.params?.safeParse(overLimit).success).toBe(false)
  })

  it('sends a notification through the internal API with the host token', async () => {
    const fetchMock = jsonResponse({ delivered: 2, expired: 0, failed: 0, noSubscriptions: false })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await tool.execute({
      action: 'send_notification',
      params: { title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/notifications/send')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(JSON.parse(init.body)).toEqual({ title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' })
    expect(result).toBe('Notification sent: 2 delivered, 0 failed.')
  })

  it('reports when the user has no registered devices', async () => {
    vi.stubGlobal('fetch', jsonResponse({ delivered: 0, expired: 0, failed: 0, noSubscriptions: true }))
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'send_notification', params: { title: 't', body: 'b' } }))
      .resolves.toBe('No devices are registered for push notifications, so nothing was delivered.')
  })

  it('surfaces the API status and body when the request is rejected', async () => {
    vi.stubGlobal('fetch', jsonResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }))
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'send_notification', params: { title: 't', body: 'b' } }))
      .rejects.toThrow(/429.*Rate limit exceeded/)
  })

  it('fails when the internal API is not configured', async () => {
    delete process.env.OCM_INTERNAL_TOKEN
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'send_notification', params: { title: 't', body: 'b' } }))
      .rejects.toThrow('The OpenCode Manager internal API is not configured for this OpenCode server.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects unknown actions and invalid params without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'constructor', params: {} })).rejects.toThrow(/Unknown OpenCode Manager action/)
    await expect(tool.execute({ action: 'send_notification', params: { title: 't' } })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends an allow-listed GET request with a query string and no body', async () => {
    const fetchMock = jsonResponse({ userId: 'default', theme: 'dark' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    const result = await tool.execute({
      action: 'request',
      params: { method: 'GET', path: '/settings?userId=default' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/settings?userId=default')
    expect(init.method).toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBeUndefined()
    expect(init.body).toBeUndefined()
    expect(result).toBe('{"userId":"default","theme":"dark"}')
  })

  it('sends a PATCH request with a JSON body', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await tool.execute({
      action: 'request',
      params: { method: 'PATCH', path: '/settings', body: { theme: 'dark' } },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/settings')
    expect(init.method).toBe('PATCH')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ theme: 'dark' })
  })

  it('sends a PUT request with a JSON body', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await tool.execute({
      action: 'request',
      params: { method: 'PUT', path: '/opencode-config', body: { content: { theme: 'dark' } } },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:5003/api/internal/opencode-config')
    expect(init.method).toBe('PUT')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ content: { theme: 'dark' } })
  })

  it('allows every route in the exported allow list', async () => {
    const tool = await loadTool(configHome)

    for (const route of MANAGER_TOOL_ALLOWED_ROUTES) {
      const { method, path: pattern } = parseAllowedRoute(route)
      const path = pattern.split('/').map((segment) => (segment === '*' ? 'x' : segment)).join('/')
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await tool.execute({ action: 'request', params: { method, path } })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects non-allow-listed routes without calling the API', async () => {
    const tool = await loadTool(configHome)
    const deniedRoutes = [
      ['GET', '/git-credentials/gh-env'],
      ['GET', '/repos/0/mirror/head'],
      ['POST', '/notifications/send'],
      ['DELETE', '/settings'],
    ] as const

    for (const [method, path] of deniedRoutes) {
      const fetchMock = jsonResponse({})
      vi.stubGlobal('fetch', fetchMock)

      await expect(tool.execute({ action: 'request', params: { method, path } }))
        .rejects.toThrow(/is not an allowed OpenCode Manager route/)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('normalizes path traversal and rejects the resolved route without calling the API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(
      tool.execute({ action: 'request', params: { method: 'GET', path: '/repos/x/../../git-credentials/gh-env' } }),
    ).rejects.toThrow(/is not an allowed OpenCode Manager route/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an absolute URL that resolves outside the internal API', async () => {
    const fetchMock = jsonResponse({})
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'request', params: { method: 'GET', path: 'http://evil.com/steal' } }))
      .rejects.toThrow(/resolves outside/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the empty-body message when the response body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'request', params: { method: 'GET', path: '/settings' } }))
      .resolves.toBe('The request succeeded with an empty response body.')
  })

  it('surfaces the API status and body when the request action is rejected', async () => {
    vi.stubGlobal('fetch', jsonResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }))
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'request', params: { method: 'GET', path: '/settings' } }))
      .rejects.toThrow(/429.*Rate limit exceeded/)
  })
})

/**
 * The manager tells tenants apart by the session id OpenCode hands to every
 * tool call, carried on one header. The plugin's whole job is to pass that id
 * along faithfully.
 */
describe('ocm-manager plugin session labelling', () => {
  let configHome: string

  beforeEach(async () => {
    configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ocm-manager-'))
    await installManagedPlugins(configHome)
    process.env.OCM_INTERNAL_API_URL = 'http://localhost:5003/api/internal'
    process.env.OCM_INTERNAL_TOKEN = 'secret-token'
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.OCM_INTERNAL_API_URL
    delete process.env.OCM_INTERNAL_TOKEN
    await fs.rm(configHome, { recursive: true, force: true })
  })

  function headersOfCall(fetchMock: ReturnType<typeof jsonResponse>, index = 0): Record<string, string> {
    const [, init] = fetchMock.mock.calls[index] ?? []
    return (init?.headers ?? {}) as Record<string, string>
  }

  it('labels the request with the session the tool was called in', async () => {
    const fetchMock = jsonResponse({ userId: 'default' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await tool.execute(
      { action: 'request', params: { method: 'GET', path: '/settings' } },
      { sessionID: 'ses_alice', directory: '/workspace/users/alice/workspace' },
    )

    expect(headersOfCall(fetchMock)['X-OCM-Session']).toBe('ses_alice')
  })

  it('labels a notification the same way', async () => {
    // Only labelling the request action would leave push notifications
    // unattributed, and those are the calls an assistant makes most often.
    const fetchMock = jsonResponse({ delivered: 1, expired: 0, failed: 0, noSubscriptions: false })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await tool.execute(
      { action: 'send_notification', params: { title: 't', body: 'b' } },
      { sessionID: 'ses_alice' },
    )

    expect(headersOfCall(fetchMock)['X-OCM-Session']).toBe('ses_alice')
  })

  it('still serves the action when no session was provided', async () => {
    // The point of shadow mode: an unlabelled request must be visible, not
    // broken. Refusing here would take the tool away from every session at
    // once, to fix something the manager can already see.
    const fetchMock = jsonResponse({ userId: 'default' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await expect(tool.execute({ action: 'request', params: { method: 'GET', path: '/settings' } }))
      .resolves.toContain('default')
    expect(headersOfCall(fetchMock)['X-OCM-Session']).toBeUndefined()

    await expect(tool.execute({ action: 'request', params: { method: 'GET', path: '/settings' } }, {}))
      .resolves.toContain('default')
  })

  it('does not send a session that is absent, empty or undefined', async () => {
    // A header carrying the text "undefined" is worse than no header: the
    // manager would look up a session called "undefined" and find nothing,
    // which reads as "unknown session" instead of "no session".
    const fetchMock = jsonResponse({ userId: 'default' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    for (const sessionID of [undefined, '', '   ']) {
      await tool.execute(
        { action: 'request', params: { method: 'GET', path: '/settings' } },
        { sessionID },
      )
    }

    const sent = fetchMock.mock.calls.map((_, i) => headersOfCall(fetchMock, i)['X-OCM-Session'])
    expect(sent).toEqual([undefined, undefined, undefined])
  })

  it('keeps two concurrent calls from wearing each other session', async () => {
    // One OpenCode process serves every tenant. A module-level variable would
    // be overwritten by whichever call set it last, and the other request
    // would go out silently claiming the wrong tenant - the request still
    // succeeds, so nothing would ever show it.
    //
    // The two calls are held at the fetch until both have arrived, so they
    // really are in flight together rather than merely started together. Note
    // that this only bites if something awaits *before* the header is built:
    // today nothing does, so a shared variable would still pass. That is the
    // reason the session id is a parameter and not a variable, and this test
    // is the thing that notices if someone adds an early await.
    const arrived: (() => void)[] = []
    const bothArrived = new Promise<void>((resolve) => {
      arrived.push(resolve)
      arrived.push(resolve)
    })
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls >= 2) arrived.forEach((release) => release())
      await bothArrived
      return { ok: true, status: 200, text: async () => '{"userId":"default"}' }
    })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await Promise.all([
      tool.execute({ action: 'request', params: { method: 'GET', path: '/settings' } }, { sessionID: 'ses_alice' }),
      tool.execute({ action: 'request', params: { method: 'GET', path: '/settings' } }, { sessionID: 'ses_bob' }),
    ])

    const sent = fetchMock.mock.calls.map((_, i) => headersOfCall(fetchMock, i)['X-OCM-Session'])
    expect(sent).toHaveLength(2)
    expect(sent.filter((id) => id === 'ses_alice')).toHaveLength(1)
    expect(sent.filter((id) => id === 'ses_bob')).toHaveLength(1)
  })

  it('coerces a non-string session id rather than sending an object', async () => {
    const fetchMock = jsonResponse({ userId: 'default' })
    vi.stubGlobal('fetch', fetchMock)
    const tool = await loadTool(configHome)

    await tool.execute(
      { action: 'request', params: { method: 'GET', path: '/settings' } },
      { sessionID: 12345 as unknown as string },
    )

    expect(headersOfCall(fetchMock)['X-OCM-Session']).toBe('12345')
  })
})

function resolveOpencodeBinary(): string | null {
  const candidates = [
    process.env.OPENCODE_BIN,
    'opencode',
    '/usr/local/bin/opencode',
    '/opt/opencode/bin/opencode',
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 })
      if (result.status === 0 && result.stdout && result.stdout.trim().length > 0) {
        return candidate
      }
    } catch {
      continue
    }
  }
  return null
}

const SHIPPED_OPENCODE_BIN = resolveOpencodeBinary()

type ChatRequest = { messages?: unknown[]; tools?: { function?: { name?: string; parameters?: unknown } }[] }

describe.skipIf(SHIPPED_OPENCODE_BIN === null)('ocm-manager plugin against the shipped OpenCode binary', () => {
  let root: string

  function startInternalApiServer(requests: string[]) {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        if (req.method === 'POST' && req.url?.endsWith('/notifications/send')) {
          requests.push(JSON.stringify({
            auth: req.headers.authorization,
            session: req.headers['x-ocm-session'] ?? null,
            body,
          }))
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ delivered: 1, expired: 0, failed: 0, noSubscriptions: false }))
      })
    })
    return new Promise<{ server: http.Server; port: number }>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }))
    })
  }

  function startLlmServer(offeredTools: ChatRequest['tools'][], toolResults: string[]) {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
        return
      }
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404)
        res.end()
        return
      }
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as ChatRequest
        offeredTools.push(parsed.tools ?? [])
        const messages = parsed.messages ?? []
        const toolMessages = messages.filter((m) => (m as { role?: string }).role === 'tool')
        for (const message of toolMessages) {
          toolResults.push(String((message as { content?: unknown }).content ?? ''))
        }

        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const writeChunk = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
        const base = { id: 'chatcmpl-e2e', object: 'chat.completion.chunk', created: 1, model: 'mock-model' }
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0

        if (hasTools && toolMessages.length === 0) {
          const args = JSON.stringify({
            action: 'send_notification',
            params: { title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' },
          })
          writeChunk({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: MANAGER_TOOL_NAME, arguments: '' } }],
                },
                finish_reason: null,
              },
            ],
          })
          writeChunk({
            ...base,
            choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }],
          })
          writeChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
        } else {
          writeChunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
          writeChunk({ ...base, choices: [{ index: 0, delta: { content: 'FINAL' }, finish_reason: null }] })
          writeChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
        }
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    return new Promise<{ server: http.Server; port: number }>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }))
    })
  }

  function writeOpenCodeConfig(configHome: string, llmPort: number) {
    writeFileSync(
      path.join(configHome, 'opencode', 'opencode.json'),
      JSON.stringify({
        provider: {
          mock: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Mock',
            options: { baseURL: `http://127.0.0.1:${llmPort}/v1`, apiKey: 'mock-key' },
            models: { 'mock-model': { name: 'Mock Model' } },
          },
        },
        model: 'mock/mock-model',
        permission: { bash: 'allow', read: 'allow', edit: 'allow', write: 'allow' },
      }),
    )
  }

  function runOpencode(workDir: string, env: Record<string, string>) {
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(SHIPPED_OPENCODE_BIN as string, ['run', '--auto', '--format', 'json', 'notify the user'], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ status: null, stdout, stderr })
      }, 90000)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ status: code, stdout, stderr })
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ocm-manager-e2e-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('offers the tool to the model and sends the notification from the Manager process', async () => {
    const configHome = path.join(root, 'config')
    const workDir = path.join(root, 'work')
    mkdirSync(path.join(configHome, 'opencode', 'plugin'), { recursive: true })
    mkdirSync(workDir, { recursive: true })

    const apiRequests: string[] = []
    const offeredTools: ChatRequest['tools'][] = []
    const toolResults: string[] = []
    const api = await startInternalApiServer(apiRequests)
    const llm = await startLlmServer(offeredTools, toolResults)
    writeOpenCodeConfig(configHome, llm.port)
    await installManagedPlugins(configHome)

    try {
      const result = await runOpencode(workDir, {
        ...process.env,
        HOME: root,
        XDG_CONFIG_HOME: configHome,
        PWD: workDir,
        OCM_INTERNAL_API_URL: `http://127.0.0.1:${api.port}/api/internal`,
        OCM_INTERNAL_TOKEN: 'test-token',
      })

      expect(result.status).toBe(0)

      const managerTool = offeredTools.flatMap((tools) => tools ?? []).find((t) => t.function?.name === MANAGER_TOOL_NAME)
      expect(managerTool?.function?.parameters).toMatchObject({
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['send_notification', 'request'] },
          params: {
            anyOf: [
              {
                type: 'object',
                required: ['title', 'body'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX },
                  body: { type: 'string', minLength: 1, maxLength: ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX },
                  url: { type: 'string', maxLength: ASSISTANT_NOTIFICATION_LIMITS.URL_MAX },
                  tag: { type: 'string', maxLength: ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX },
                  priority: { type: 'string', enum: ['normal', 'high'] },
                },
              },
              {
                type: 'object',
                required: ['method', 'path'],
                properties: {
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
                  path: { type: 'string', minLength: 1, maxLength: 500 },
                  body: { type: 'object' },
                },
              },
            ],
          },
        },
        required: ['action', 'params'],
      })

      expect(apiRequests).toHaveLength(1)
      const request = JSON.parse(apiRequests[0] as string) as { auth: string; session: string | null; body: string }
      expect(request.auth).toBe('Bearer test-token')
      // The whole identity scheme rests on OpenCode passing a session id to
      // `execute`. The unit tests can only prove the plugin forwards one it is
      // given; this is the only place that proves OpenCode gives it one, and
      // it runs against the binary we actually ship. If this ever goes null,
      // stop and find out why - every request would be unattributable.
      expect(request.session, 'OpenCode did not pass a session id to the tool').toBeTruthy()
      expect(request.session).not.toBe('undefined')
      expect(JSON.parse(request.body)).toEqual({ title: 'Storm watch', body: 'Formation odds crossed 40%', priority: 'high' })
      expect(toolResults.some((output) => output.includes('Notification sent: 1 delivered, 0 failed.'))).toBe(true)
    } finally {
      api.server.close()
      llm.server.close()
    }
  }, 120000)
})
