import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { eventSourceState } = vi.hoisted(() => {
  const instances: Array<{
    url: string
    init: unknown
    close: ReturnType<typeof vi.fn>
    onopen: (() => void) | null
    onerror: ((event: unknown) => void) | null
    onmessage: ((event: { data: string }) => void) | null
  }> = []

  class EventSourceMock {
    url: string
    init: unknown
    close = vi.fn()
    onopen: (() => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null

    constructor(url: string, init?: unknown) {
      this.url = url
      this.init = init
      instances.push(this)
    }
  }

  return { eventSourceState: { instances, EventSourceMock } }
})

vi.mock('eventsource', () => ({
  EventSource: eventSourceState.EventSourceMock,
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
  },
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { DEFAULTS } from '@opencode-manager/shared/config'
import { logger } from '../../src/utils/logger'
import {
  sseAggregator,
  broadcastSSHHostKeyRequest,
  type PendingActionsFetcher,
} from '../../src/services/sse-aggregator'

interface CapturedEvent {
  event: string
  data: string
}

function createCapturingClient() {
  const events: CapturedEvent[] = []
  const frames: string[] = []
  const decoder = new TextDecoder()
  const callback = (event: string, data: string) => {
    events.push({ event, data })
  }
  const writeFrame = (frame: Uint8Array) => {
    frames.push(decoder.decode(frame))
  }
  return { callback, writeFrame, events, frames }
}

function makeFetcher(
  map: Record<string, { permissions?: unknown[]; questions?: unknown[]; statuses?: Record<string, { type: string }> }>,
): PendingActionsFetcher {
  return {
    async getJson<T>(path: string, opts?: { directory?: string }): Promise<T> {
      const directory = opts?.directory ?? ''
      const entry = map[directory] ?? {}
      if (path === '/permission') return (entry.permissions ?? []) as T
      if (path === '/question') return (entry.questions ?? []) as T
      if (path === '/session/status') return (entry.statuses ?? {}) as T
      throw new Error(`unexpected path: ${path}`)
    },
  }
}

async function flushReplay(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

describe('SSEAggregator pending replay on connect', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
  })

  it('replays pending permissions and questions to a new client per subscribed directory', async () => {
    const fetcher = makeFetcher({
      '/repo/a': {
        permissions: [
          { id: 'perm-1', sessionID: 'sess-a' },
          { id: 'perm-2', sessionID: 'sess-a' },
        ],
        questions: [{ id: 'q-1', sessionID: 'sess-a', questions: [] }],
      },
      '/repo/b': {
        permissions: [{ id: 'perm-3', sessionID: 'sess-b' }],
        questions: [],
      },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-1', callback, writeFrame, ['/repo/a', '/repo/b'])

    await flushReplay()

    expect(events).toHaveLength(4)

    const parsed = events.map(e => JSON.parse(e.data) as { directory: string; payload: { type: string; properties: { id: string } } })

    expect(parsed.filter(p => p.payload.type === 'permission.asked' && p.directory === '/repo/a').map(p => p.payload.properties.id)).toEqual([
      'perm-1',
      'perm-2',
    ])
    expect(parsed.filter(p => p.payload.type === 'question.asked' && p.directory === '/repo/a').map(p => p.payload.properties.id)).toEqual(['q-1'])
    expect(parsed.filter(p => p.payload.type === 'permission.asked' && p.directory === '/repo/b').map(p => p.payload.properties.id)).toEqual([
      'perm-3',
    ])
    expect(parsed.filter(p => p.payload.type === 'question.asked' && p.directory === '/repo/b')).toHaveLength(0)
  })

  it('does not replay when no fetcher is configured', async () => {
    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-2', callback, writeFrame, ['/repo/a'])

    await flushReplay()

    expect(events).toHaveLength(0)
  })

  it('does not replay to other clients', async () => {
    const fetcher = makeFetcher({
      '/repo/a': { permissions: [{ id: 'perm-1', sessionID: 'sess-a' }] },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    sseAggregator.addClient('a', clientA.callback, clientA.writeFrame, ['/repo/a'])
    sseAggregator.addClient('b', clientB.callback, clientB.writeFrame, [])

    await flushReplay()

    expect(clientA.events).toHaveLength(1)
    expect(clientB.events).toHaveLength(0)
  })

  it('replays only newly added directories on addDirectories', async () => {
    const fetcher = makeFetcher({
      '/repo/a': { permissions: [{ id: 'perm-1', sessionID: 'sess-a' }] },
      '/repo/b': { permissions: [{ id: 'perm-2', sessionID: 'sess-b' }] },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-3', callback, writeFrame, ['/repo/a'])
    await flushReplay()

    const initialCount = events.length
    expect(initialCount).toBe(1)

    sseAggregator.addDirectories('client-3', ['/repo/a', '/repo/b'])
    await flushReplay()

    const newEvents = events.slice(initialCount)
    const parsed = newEvents.map(e => JSON.parse(e.data) as { directory: string; payload: { type: string; properties: { id: string } } })
    expect(parsed).toHaveLength(1)
    const [first] = parsed
    expect(first?.directory).toBe('/repo/b')
    expect(first?.payload.properties.id).toBe('perm-2')
  })

  it('survives upstream fetch failures for one directory and still replays the others', async () => {
    const fetcher: PendingActionsFetcher = {
      async getJson<T>(path: string, opts?: { directory?: string }): Promise<T> {
        if (opts?.directory === '/repo/broken') {
          throw new Error('upstream down')
        }
        if (path === '/permission' && opts?.directory === '/repo/ok') {
          return [{ id: 'perm-ok', sessionID: 's' }] as unknown as T
        }
        return [] as unknown as T
      },
    }
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-4', callback, writeFrame, ['/repo/broken', '/repo/ok'])
    await flushReplay()

    const parsed = events.map(e => JSON.parse(e.data) as { directory: string; payload: { properties: { id: string } } })
    expect(parsed).toHaveLength(1)
    const [first] = parsed
    expect(first?.directory).toBe('/repo/ok')
    expect(first?.payload.properties.id).toBe('perm-ok')
  })

  it('does not deliver replay events to a client that no longer subscribes to that directory', async () => {
    let resolvePermissions: (val: unknown[]) => void = () => {}
    const fetcher: PendingActionsFetcher = {
      async getJson<T>(path: string): Promise<T> {
        if (path === '/permission') {
          return new Promise<T>((resolve) => {
            resolvePermissions = resolve as (val: unknown[]) => void
          })
        }
        return [] as unknown as T
      },
    }
    sseAggregator.setPendingActionsFetcher(fetcher)

    const { callback, writeFrame, events } = createCapturingClient()
    sseAggregator.addClient('client-5', callback, writeFrame, ['/repo/a'])

    sseAggregator.removeDirectories('client-5', ['/repo/a'])
    resolvePermissions([{ id: 'late', sessionID: 's' }])

    await flushReplay()

    expect(events).toHaveLength(0)
  })
})

describe('SSEAggregator session status replay on upstream reconnect', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
  })

  it('re-emits active session statuses to subscribed clients', async () => {
    const fetcher = makeFetcher({
      '/repo/a': { statuses: { 'sess-1': { type: 'busy' }, 'sess-2': { type: 'idle' } } },
    })
    sseAggregator.setPendingActionsFetcher(fetcher)

    const clientA = createCapturingClient()
    sseAggregator.addClient('status-1', clientA.callback, clientA.writeFrame, ['/repo/a'])

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    const parsed = clientA.frames.map(f => JSON.parse(f.replace(/^event: message\ndata: /, '').trim()) as {
      directory: string
      payload: { type: string; properties: { sessionID: string; status: { type: string } } }
    })

    const statusEvents = parsed.filter(p => p.payload.type === 'session.status')
    expect(statusEvents).toHaveLength(1)
    expect(statusEvents[0]?.payload.properties.sessionID).toBe('sess-1')
    expect(statusEvents[0]?.payload.properties.status.type).toBe('busy')
  })

  it('emits idle for sessions that finished during the disconnect', async () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('status-2', clientA.callback, clientA.writeFrame, ['/repo/a'])

    const busy = JSON.stringify({ directory: '/repo/a', payload: { type: 'session.status', properties: { sessionID: 'sess-9', status: { type: 'busy' } } } })
    ;(sseAggregator as any).handleUpstreamMessage(busy)

    sseAggregator.setPendingActionsFetcher(makeFetcher({ '/repo/a': { statuses: {} } }))

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    const parsed = clientA.frames.map(f => JSON.parse(f.replace(/^event: message\ndata: /, '').trim()) as {
      payload: { type: string; properties: { sessionID: string; status: { type: string } } }
    })
    const idleEvents = parsed.filter(p => p.payload.type === 'session.status' && p.payload.properties.status.type === 'idle')
    expect(idleEvents).toHaveLength(1)
    expect(idleEvents[0]?.payload.properties.sessionID).toBe('sess-9')
  })

  it('does nothing when no fetcher is configured', async () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('status-3', clientA.callback, clientA.writeFrame, ['/repo/a'])

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(clientA.frames).toHaveLength(0)
  })
})

describe('SSEAggregator scheduled session replay without a connected client', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
    sseAggregator.setPendingActionsFetcher(null)
    sseAggregator.setScheduledSessionsResolver(() => [])
  })

  it('replays a scheduled directory that no browser client is subscribed to', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({
      '/worktrees/run-1': { statuses: { 'ses-sched': { type: 'busy' } } },
    }))
    sseAggregator.setScheduledSessionsResolver(() => [
      { sessionID: 'ses-sched', directory: '/worktrees/run-1' },
    ])

    const seen: Array<{ directory: string; type: string; sessionID: string; status: string }> = []
    sseAggregator.onEvent((directory, event) => {
      const properties = event.properties as { sessionID?: string; status?: { type?: string } }
      seen.push({
        directory,
        type: event.type,
        sessionID: properties.sessionID ?? '',
        status: properties.status?.type ?? '',
      })
    })

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(seen).toEqual([
      { directory: '/worktrees/run-1', type: 'session.status', sessionID: 'ses-sched', status: 'busy' },
    ])
  })

  it('emits idle for a scheduled session that finished while the stream was down and was never marked active', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({
      '/worktrees/run-2': { statuses: {} },
    }))
    sseAggregator.setScheduledSessionsResolver(() => [
      { sessionID: 'ses-finished', directory: '/worktrees/run-2' },
    ])

    const idle: string[] = []
    sseAggregator.onEvent((_directory, event) => {
      const properties = event.properties as { sessionID?: string; status?: { type?: string } }
      if (event.type === 'session.status' && properties.status?.type === 'idle') {
        idle.push(properties.sessionID ?? '')
      }
    })

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(idle).toEqual(['ses-finished'])
  })
})

describe('SSEAggregator directory-indexed broadcast', () => {
  beforeEach(() => {
    sseAggregator.shutdown()
  })

  it('delivers only to clients subscribed to the event directory', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()
    sseAggregator.addClient('index-a', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.addClient('index-b', clientB.callback, clientB.writeFrame, ['/b'])

    const data = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(1)
    expect(clientB.frames).toHaveLength(0)
  })

  it('does not encode a frame when no client subscribes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-c', clientA.callback, clientA.writeFrame, ['/a'])

    const data = JSON.stringify({ directory: '/z', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(0)
  })

  it('removeClient deindexes', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-d', clientA.callback, clientA.writeFrame, ['/a'])
    sseAggregator.removeClient('index-d')

    const data = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(0)
  })

  it('addDirectories then delivery', () => {
    const clientA = createCapturingClient()
    sseAggregator.addClient('index-e', clientA.callback, clientA.writeFrame, [])
    sseAggregator.addDirectories('index-e', ['/a'])

    const data = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(data)

    expect(clientA.frames).toHaveLength(1)
  })

  it('replacing a client ID deindexes old directories', () => {
    const clientA = createCapturingClient()
    const clientB = createCapturingClient()

    // Add client with id 'index-f' subscribed to /a
    sseAggregator.addClient('index-f', clientA.callback, clientA.writeFrame, ['/a'])

    // Replace same client ID with different directories (no /a)
    sseAggregator.addClient('index-f', clientB.callback, clientB.writeFrame, ['/b'])

    // Message for /a should NOT reach either client
    const dataA = JSON.stringify({ directory: '/a', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(dataA)

    expect(clientA.frames).toHaveLength(0)
    expect(clientB.frames).toHaveLength(0)

    // Message for /b should reach clientB
    const dataB = JSON.stringify({ directory: '/b', payload: { type: 'test', properties: {} } })
    ;(sseAggregator as any).handleUpstreamMessage(dataB)

    expect(clientB.frames).toHaveLength(1)
  })
})

interface MockUpstream {
  url: string
  init: unknown
  close: ReturnType<typeof vi.fn>
  onopen: (() => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
}

function createFrameRecordingClient() {
  const frames: Uint8Array[] = []
  return { callback: () => {}, writeFrame: (frame: Uint8Array) => { frames.push(frame) }, frames }
}

function upstreamAt(index: number): MockUpstream {
  const instance = eventSourceState.instances[index]
  if (!instance) throw new Error(`no upstream at index ${index}`)
  return instance
}

function envelope(directory: string, type: string, properties: Record<string, unknown> = {}): string {
  return JSON.stringify({ directory, payload: { type, properties } })
}

function resetAggregator(): void {
  sseAggregator.shutdown()
  sseAggregator.setPendingActionsFetcher(null)
  sseAggregator.setPasswordResolver(null)
  sseAggregator.setScheduledSessionsResolver(() => [])
  const internal = sseAggregator as unknown as {
    everConnected: boolean
    upstreamConnected: boolean
    reconnectDelay: number
  }
  internal.everConnected = false
  internal.upstreamConnected = false
  internal.reconnectDelay = DEFAULTS.SSE.RECONNECT_DELAY_MS
  eventSourceState.instances.length = 0
  vi.clearAllMocks()
}

describe('SSEAggregator upstream connection lifecycle', () => {
  beforeEach(resetAggregator)

  afterEach(() => {
    sseAggregator.shutdown()
    vi.useRealTimers()
  })

  it('reports no upstream at all before start is called', () => {
    expect(sseAggregator.getConnectionStatus()).toEqual({ connected: 0, total: 0 })
    expect(eventSourceState.instances).toHaveLength(0)
  })

  it('opens the global event stream on the configured upstream port when started', () => {
    sseAggregator.start()
    expect(eventSourceState.instances).toHaveLength(1)
    expect(upstreamAt(0).url).toBe('http://127.0.0.1:5551/global/event')
    expect(sseAggregator.getConnectionStatus()).toEqual({ connected: 0, total: 1 })
  })

  it('does not open a second stream when start is called twice', () => {
    sseAggregator.start()
    sseAggregator.start()
    expect(eventSourceState.instances).toHaveLength(1)
  })

  it('does nothing on reconnect when the aggregator was never started', () => {
    sseAggregator.reconnect()
    expect(eventSourceState.instances).toHaveLength(0)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('does not open an upstream connection while stopped', async () => {
    sseAggregator.shutdown()
    await (sseAggregator as any).connectUpstream()
    expect(eventSourceState.instances).toHaveLength(0)
  })

  it('marks the upstream connected once the stream opens', () => {
    sseAggregator.start()
    upstreamAt(0).onopen!()
    expect(sseAggregator.getConnectionStatus()).toEqual({ connected: 1, total: 1 })
  })

  it('marks the upstream disconnected when the stream errors', () => {
    sseAggregator.start()
    upstreamAt(0).onopen!()
    upstreamAt(0).onerror!({ code: 500 })
    expect(sseAggregator.getConnectionStatus()).toEqual({ connected: 0, total: 1 })
  })

  it('logs the upstream error together with its code and message', () => {
    sseAggregator.start()
    upstreamAt(0).onerror!({ code: 500, message: 'boom' })
    expect(logger.warn).toHaveBeenCalledWith('SSE upstream error (code=500): boom')
    expect(upstreamAt(0).close).toHaveBeenCalledTimes(1)
  })

  it('logs a bare upstream error when no code or message is supplied', () => {
    sseAggregator.start()
    upstreamAt(0).onerror!({})
    expect(logger.warn).toHaveBeenCalledWith('SSE upstream error')
  })

  it('omits only the message when the error carries no code', () => {
    sseAggregator.start()
    upstreamAt(0).onerror!({ message: 'reset by peer' })
    expect(logger.warn).toHaveBeenCalledWith('SSE upstream error: reset by peer')
  })

  it('ignores errors from a superseded stream without scheduling a reconnect', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    sseAggregator.reconnect()
    expect(eventSourceState.instances).toHaveLength(2)

    upstreamAt(0).onerror!({ code: 500 })
    vi.advanceTimersByTime(60_000)

    expect(eventSourceState.instances).toHaveLength(2)
  })

  it('closes the previous stream and opens a new one on reconnect', () => {
    sseAggregator.start()
    sseAggregator.reconnect()
    expect(eventSourceState.instances).toHaveLength(2)
    expect(upstreamAt(0).close).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith('SSE forcing upstream reconnect (auth changed)')
  })

  it('cancels a pending reconnect timer instead of connecting twice', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    upstreamAt(0).onerror!({ code: 500 })
    expect(eventSourceState.instances).toHaveLength(1)

    sseAggregator.reconnect()
    expect(eventSourceState.instances).toHaveLength(2)

    vi.advanceTimersByTime(60_000)
    expect(eventSourceState.instances).toHaveLength(2)
  })

  it('resets the backoff delay to the base value on reconnect', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    upstreamAt(0).onerror!({ code: 500 })
    vi.advanceTimersByTime(DEFAULTS.SSE.RECONNECT_DELAY_MS)
    expect((sseAggregator as any).reconnectDelay).toBe(DEFAULTS.SSE.RECONNECT_DELAY_MS * 2)

    sseAggregator.reconnect()
    expect((sseAggregator as any).reconnectDelay).toBe(DEFAULTS.SSE.RECONNECT_DELAY_MS)
  })

  it('resets the backoff delay once a stream opens successfully', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    upstreamAt(0).onerror!({ code: 500 })
    vi.advanceTimersByTime(DEFAULTS.SSE.RECONNECT_DELAY_MS)
    expect((sseAggregator as any).reconnectDelay).toBe(DEFAULTS.SSE.RECONNECT_DELAY_MS * 2)

    upstreamAt(1).onopen!()
    expect((sseAggregator as any).reconnectDelay).toBe(DEFAULTS.SSE.RECONNECT_DELAY_MS)
  })

  it('doubles the reconnect delay and caps it at the maximum', () => {
    vi.useFakeTimers()
    sseAggregator.start()

    let expected: number = DEFAULTS.SSE.RECONNECT_DELAY_MS
    for (let attempt = 0; attempt < 8; attempt++) {
      upstreamAt(eventSourceState.instances.length - 1).onerror!({ code: 500 })
      vi.advanceTimersByTime(expected)
      const next = Math.min(expected * 2, DEFAULTS.SSE.MAX_RECONNECT_DELAY_MS)
      expect((sseAggregator as any).reconnectDelay).toBe(next)
      expected = next
    }

    expect((sseAggregator as any).reconnectDelay).toBe(DEFAULTS.SSE.MAX_RECONNECT_DELAY_MS)
    expect(eventSourceState.instances).toHaveLength(9)
  })

  it('does not schedule a reconnect while stopped', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    sseAggregator.shutdown()
    ;(sseAggregator as any).scheduleReconnect()
    vi.advanceTimersByTime(60_000)
    expect(eventSourceState.instances).toHaveLength(1)
  })

  it('does not schedule a second reconnect while one is already pending', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    upstreamAt(0).onerror!({ code: 500 })
    ;(sseAggregator as any).scheduleReconnect()
    vi.advanceTimersByTime(DEFAULTS.SSE.RECONNECT_DELAY_MS)
    expect(eventSourceState.instances).toHaveLength(2)
  })

  it('clears a pending reconnect timer on shutdown', () => {
    vi.useFakeTimers()
    sseAggregator.start()
    upstreamAt(0).onerror!({ code: 500 })
    sseAggregator.shutdown()
    vi.advanceTimersByTime(60_000)
    expect(eventSourceState.instances).toHaveLength(1)
  })

  it('closes the upstream stream on shutdown', () => {
    sseAggregator.start()
    sseAggregator.shutdown()
    expect(upstreamAt(0).close).toHaveBeenCalledTimes(1)
    expect(sseAggregator.getConnectionStatus()).toEqual({ connected: 0, total: 0 })
  })

  it('omits the custom fetch init when no password is configured', () => {
    sseAggregator.start()
    expect(upstreamAt(0).init).toBeUndefined()
  })

  it('attaches an authorization header when a password resolver is configured', async () => {
    sseAggregator.setPasswordResolver(() => 'secret')
    sseAggregator.start()
    await flushReplay()

    const init = upstreamAt(0).init as { fetch: (input: unknown, fetchInit: unknown) => Promise<unknown> }
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await init.fetch('http://127.0.0.1:5551/global/event', { headers: { 'X-Test': '1' } })

    const passedInit = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }
    expect(passedInit.headers.Authorization).toMatch(/^Basic /)
    expect(passedInit.headers['X-Test']).toBe('1')
    vi.unstubAllGlobals()
  })

  it('resolves an async password resolver before connecting', async () => {
    sseAggregator.setPasswordResolver(async () => 'async-secret')
    sseAggregator.start()
    expect(eventSourceState.instances).toHaveLength(0)
    await flushReplay()
    expect(eventSourceState.instances).toHaveLength(1)
    expect(upstreamAt(0).init).toBeDefined()
  })

  it('drops the authorization header once the password resolver is cleared', async () => {
    sseAggregator.setPasswordResolver(() => 'secret')
    sseAggregator.start()
    await flushReplay()
    expect(upstreamAt(0).init).toBeDefined()

    sseAggregator.setPasswordResolver(null)
    sseAggregator.reconnect()
    expect(upstreamAt(1).init).toBeUndefined()
  })

  it('forwards upstream messages to the subscribers of the event directory', () => {
    sseAggregator.start()
    const client = createCapturingClient()
    sseAggregator.addClient('msg-1', client.callback, client.writeFrame, ['/a'])

    upstreamAt(0).onmessage!({ data: envelope('/a', 'session.idle', { sessionID: 'ses_1' }) })

    expect(client.frames).toHaveLength(1)
    expect(client.frames[0]).toContain('event: message\n')
  })

  it('shares one encoded frame instance across every subscriber of a directory', () => {
    sseAggregator.start()
    const first = createFrameRecordingClient()
    const second = createFrameRecordingClient()
    sseAggregator.addClient('frame-1', first.callback, first.writeFrame, ['/a'])
    sseAggregator.addClient('frame-2', second.callback, second.writeFrame, ['/a'])

    upstreamAt(0).onmessage!({ data: envelope('/a', 'test') })

    expect(first.frames).toHaveLength(1)
    expect(second.frames).toHaveLength(1)
    expect(first.frames[0]).toBe(second.frames[0])
  })

  it('keeps delivering to healthy subscribers when one write throws', () => {
    sseAggregator.start()
    const healthy = createCapturingClient()
    sseAggregator.addClient('write-bad', () => {}, () => { throw new Error('socket closed') }, ['/a'])
    sseAggregator.addClient('write-ok', healthy.callback, healthy.writeFrame, ['/a'])

    upstreamAt(0).onmessage!({ data: envelope('/a', 'test') })

    expect(healthy.frames).toHaveLength(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send to client write-bad:',
      expect.any(Error),
    )
  })
})

describe('SSEAggregator reconnect replay', () => {
  beforeEach(resetAggregator)

  afterEach(() => {
    sseAggregator.shutdown()
  })

  it('does not replay on the very first connection', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({ '/repo/a': { permissions: [{ id: 'perm-1', sessionID: 's' }] } }),
    )
    const client = createCapturingClient()
    sseAggregator.addClient('first-1', client.callback, client.writeFrame, ['/repo/a'])
    await flushReplay()
    expect(client.events).toHaveLength(1)

    sseAggregator.start()
    upstreamAt(0).onopen!()
    await flushReplay()

    expect(client.events).toHaveLength(1)
  })

  it('replays pending actions to every subscribed client after a reconnect', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({
        '/repo/a': { permissions: [{ id: 'perm-a', sessionID: 's' }] },
        '/repo/b': { questions: [{ id: 'q-b', sessionID: 's' }] },
      }),
    )

    const first = createCapturingClient()
    const second = createCapturingClient()
    sseAggregator.addClient('rc-1', first.callback, first.writeFrame, ['/repo/a'])
    sseAggregator.addClient('rc-2', second.callback, second.writeFrame, ['/repo/a', '/repo/b'])
    await flushReplay()

    const firstBefore = first.events.length
    const secondBefore = second.events.length

    sseAggregator.start()
    upstreamAt(0).onopen!()
    sseAggregator.reconnect()
    upstreamAt(1).onopen!()
    await flushReplay()

    expect(first.events.length).toBeGreaterThan(firstBefore)
    expect(second.events.length).toBeGreaterThan(secondBefore)
  })

  it('replays session statuses for tracked directories after a reconnect', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({ '/repo/a': { statuses: { 'ses-9': { type: 'busy' } } } }),
    )
    const client = createCapturingClient()
    sseAggregator.addClient('rc-3', client.callback, client.writeFrame, ['/repo/a'])

    sseAggregator.start()
    upstreamAt(0).onopen!()
    sseAggregator.reconnect()
    upstreamAt(1).onopen!()
    await flushReplay()

    const replayed = client.frames
      .map((f) => JSON.parse(f.replace(/^event: message\ndata: /, '').trim()) as { payload: { type: string } })
      .filter((p) => p.payload.type === 'session.status')
    expect(replayed).toHaveLength(1)
  })

  it('skips the pending replay when no client has a directory subscription', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({ '/repo/a': { permissions: [{ id: 'perm-1', sessionID: 's' }] } }),
    )
    sseAggregator.addClient('rc-4', () => {}, () => {}, [])

    sseAggregator.start()
    upstreamAt(0).onopen!()
    sseAggregator.reconnect()
    upstreamAt(1).onopen!()
    await flushReplay()

    expect(logger.info).not.toHaveBeenCalledWith(
      'replay: replaying pending actions to 1 client(s) after upstream reconnect',
    )
  })

  it('skips the status replay when nothing is tracked at all', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({ '/repo/a': { statuses: { 'ses-1': { type: 'busy' } } } }),
    )
    sseAggregator.start()
    upstreamAt(0).onopen!()
    sseAggregator.reconnect()
    upstreamAt(1).onopen!()
    await flushReplay()

    expect(logger.info).not.toHaveBeenCalledWith(
      'replay: replaying session statuses for 1 directory(ies) after upstream reconnect',
    )
  })

  it('logs and skips a directory whose session status fetch fails', async () => {
    sseAggregator.setPendingActionsFetcher({
      async getJson<T>(path: string, opts?: { directory?: string }): Promise<T> {
        if (opts?.directory === '/broken') throw new Error('upstream down')
        if (path === '/session/status') return { 'ses-ok': { type: 'busy' } } as unknown as T
        return [] as unknown as T
      },
    })

    const client = createCapturingClient()
    sseAggregator.addClient('rc-5', client.callback, client.writeFrame, ['/ok'])
    sseAggregator.addClient('rc-6', client.callback, client.writeFrame, ['/broken'])

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(logger.warn).toHaveBeenCalledWith(
      'replay: failed to fetch session statuses for /broken: Error: upstream down',
    )
    const statuses = client.frames
      .map((f) => JSON.parse(f.replace(/^event: message\ndata: /, '').trim()) as { payload: { type: string } })
      .filter((p) => p.payload.type === 'session.status')
    expect(statuses).toHaveLength(1)
  })

  it('ignores an empty status map for a directory', async () => {
    sseAggregator.setPendingActionsFetcher(makeFetcher({ '/repo/a': { statuses: {} } }))
    const client = createCapturingClient()
    sseAggregator.addClient('rc-7', client.callback, client.writeFrame, ['/repo/a'])

    await (sseAggregator as any).replaySessionStatusesForTrackedDirectories()
    await flushReplay()

    expect(client.frames).toHaveLength(0)
  })
})

describe('SSEAggregator client lifecycle', () => {
  beforeEach(resetAggregator)

  it('returns a disposer that removes the client', () => {
    const client = createCapturingClient()
    const dispose = sseAggregator.addClient('life-1', client.callback, client.writeFrame, ['/a'])
    expect(sseAggregator.getClientCount()).toBe(1)
    dispose()
    expect(sseAggregator.getClientCount()).toBe(0)
  })

  it('ignores removal of an unknown client', () => {
    expect(() => sseAggregator.removeClient('missing')).not.toThrow()
    expect(sseAggregator.getClientCount()).toBe(0)
  })

  it('counts every connected client', () => {
    sseAggregator.addClient('life-2', () => {}, () => {}, [])
    sseAggregator.addClient('life-3', () => {}, () => {}, [])
    expect(sseAggregator.getClientCount()).toBe(2)
  })

  it('warns and returns false when adding directories for an unknown client', () => {
    expect(sseAggregator.addDirectories('missing', ['/a'])).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('addDirectories: client missing not found')
  })

  it('warns and returns false when removing directories for an unknown client', () => {
    expect(sseAggregator.removeDirectories('missing', ['/a'])).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('removeDirectories: client missing not found')
  })

  it('accepts an empty directory list for a known client', () => {
    sseAggregator.addClient('life-4', () => {}, () => {}, [])
    expect(sseAggregator.addDirectories('life-4', [])).toBe(true)
  })

  it('does not replay again when every requested directory is already subscribed', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({ '/a': { permissions: [{ id: 'p1', sessionID: 's' }] } }),
    )
    const client = createCapturingClient()
    sseAggregator.addClient('life-5', client.callback, client.writeFrame, ['/a'])
    await flushReplay()
    expect(client.events).toHaveLength(1)

    expect(sseAggregator.addDirectories('life-5', ['/a'])).toBe(true)
    await flushReplay()
    expect(client.events).toHaveLength(1)
  })

  it('logs a replay delivery failure when a client callback throws', async () => {
    sseAggregator.setPendingActionsFetcher(
      makeFetcher({
        '/a': {
          permissions: [
            { id: 'p1', sessionID: 's' },
            { id: 'p2', sessionID: 's' },
          ],
        },
      }),
    )
    sseAggregator.addClient('life-6', () => { throw new Error('client gone') }, () => {}, ['/a'])
    await flushReplay()

    expect(logger.error).toHaveBeenCalledWith(
      'replay: failed to deliver permission.asked to client life-6:',
      expect.any(Error),
    )
  })

  it('stops delivering after the client unsubscribes from the directory', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('life-7', client.callback, client.writeFrame, ['/a'])
    sseAggregator.removeDirectories('life-7', ['/a'])
    ;(sseAggregator as any).handleUpstreamMessage(envelope('/a', 'test'))
    expect(client.frames).toHaveLength(0)
  })

  it('keeps delivering after an unrelated directory is unsubscribed', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('life-8', client.callback, client.writeFrame, ['/a'])
    expect(sseAggregator.removeDirectories('life-8', ['/never-subscribed'])).toBe(true)
    ;(sseAggregator as any).handleUpstreamMessage(envelope('/a', 'test'))
    expect(client.frames).toHaveLength(1)
  })

  it('restores delivery when the client re-subscribes', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('life-9', client.callback, client.writeFrame, ['/a'])
    sseAggregator.removeDirectories('life-9', ['/a'])
    sseAggregator.addDirectories('life-9', ['/a'])
    ;(sseAggregator as any).handleUpstreamMessage(envelope('/a', 'test'))
    expect(client.frames).toHaveLength(1)
  })

  it('clears clients, sessions, and listeners on shutdown', () => {
    sseAggregator.addClient('life-10', () => {}, () => {}, ['/a'])
    ;(sseAggregator as any).handleUpstreamMessage(
      envelope('/a', 'session.status', { sessionID: 'ses-1', status: { type: 'busy' } }),
    )
    const seen: string[] = []
    sseAggregator.onEvent((_directory, event) => seen.push(event.type))
    expect(sseAggregator.getActiveDirectories()).toEqual(['/a'])

    sseAggregator.shutdown()

    expect(sseAggregator.getClientCount()).toBe(0)
    expect(sseAggregator.getActiveDirectories()).toEqual([])
    ;(sseAggregator as any).handleUpstreamMessage(envelope('/a', 'test'))
    expect(seen).toEqual([])
  })
})

describe('SSEAggregator session visibility and tracking', () => {
  beforeEach(resetAggregator)

  it('warns and returns false when setting visibility for an unknown client', () => {
    expect(sseAggregator.setClientVisibility('missing', true, 'ses-1')).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith('setClientVisibility: client missing not found')
  })

  it('reports a visible session as being viewed', () => {
    sseAggregator.addClient('vis-1', () => {}, () => {}, [])
    expect(sseAggregator.setClientVisibility('vis-1', true, 'ses-1')).toBe(true)
    expect(sseAggregator.isSessionBeingViewed('ses-1')).toBe(true)
    expect(sseAggregator.isSessionBeingViewed('ses-2')).toBe(false)
  })

  it('does not treat a hidden client as viewing its session', () => {
    sseAggregator.addClient('vis-2', () => {}, () => {}, [])
    sseAggregator.setClientVisibility('vis-2', true, 'ses-1')
    sseAggregator.setClientVisibility('vis-2', false, 'ses-1')
    expect(sseAggregator.isSessionBeingViewed('ses-1')).toBe(false)
  })

  it('never reports a session as viewed without an active session id', () => {
    sseAggregator.addClient('vis-3', () => {}, () => {}, [])
    sseAggregator.setClientVisibility('vis-3', true, null)
    expect(sseAggregator.isSessionBeingViewed('ses-1')).toBe(false)
  })

  it('reports a subagent session after a child session is created', () => {
    sseAggregator.start()
    sseAggregator.addClient('vis-4', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.created', { info: { id: 'ses-child', parentID: 'ses-parent' } }),
    })
    expect(sseAggregator.isSubagentSession('ses-child')).toBe(true)
    expect(sseAggregator.isSubagentSession('ses-parent')).toBe(false)
  })

  it('reports a subagent session for session.updated as well', () => {
    sseAggregator.start()
    sseAggregator.addClient('vis-5', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.updated', { info: { id: 'ses-child', parentID: 'ses-parent' } }),
    })
    expect(sseAggregator.isSubagentSession('ses-child')).toBe(true)
  })

  it('stops reporting a subagent session after it is deleted', () => {
    sseAggregator.start()
    sseAggregator.addClient('vis-6', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.created', { info: { id: 'ses-child', parentID: 'ses-parent' } }),
    })
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.deleted', { info: { id: 'ses-child' } }),
    })
    expect(sseAggregator.isSubagentSession('ses-child')).toBe(false)
  })

  it('ignores a session created without a parent id', () => {
    sseAggregator.start()
    sseAggregator.addClient('vis-7', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.created', { info: { id: 'ses-root' } }),
    })
    expect(sseAggregator.isSubagentSession('ses-root')).toBe(false)
  })

  it('ignores a delete for a session that was never tracked', () => {
    sseAggregator.start()
    sseAggregator.addClient('vis-8', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.deleted', { info: { id: 'ses-unknown' } }),
    })
    expect(sseAggregator.isSubagentSession('ses-unknown')).toBe(false)
  })

  it('tracks active sessions per directory and clears them on idle', () => {
    sseAggregator.start()
    sseAggregator.addClient('track-1', () => {}, () => {}, ['/a'])
    sseAggregator.addClient('track-2', () => {}, () => {}, ['/b'])

    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.status', { sessionID: 'ses-1', status: { type: 'busy' } }),
    })
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.status', { sessionID: 'ses-2', status: { type: 'busy' } }),
    })
    upstreamAt(0).onmessage!({
      data: envelope('/b', 'session.status', { sessionID: 'ses-3', status: { type: 'busy' } }),
    })

    expect(sseAggregator.getActiveDirectories().sort()).toEqual(['/a', '/b'])
    expect(sseAggregator.getActiveSessions()).toEqual({ '/a': ['ses-1', 'ses-2'], '/b': ['ses-3'] })

    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.idle', { sessionID: 'ses-1' }),
    })
    expect(sseAggregator.getActiveSessions()['/a']).toEqual(['ses-2'])
  })

  it('treats retry and compact statuses as active', () => {
    sseAggregator.start()
    sseAggregator.addClient('track-3', () => {}, () => {}, ['/a'])

    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.status', { sessionID: 'ses-retry', status: { type: 'retry' } }),
    })
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.status', { sessionID: 'ses-compact', status: { type: 'compact' } }),
    })

    expect(sseAggregator.getActiveSessions()['/a']?.sort()).toEqual(['ses-compact', 'ses-retry'])
  })

  it('removes the directory entry once its last session goes idle', () => {
    sseAggregator.start()
    sseAggregator.addClient('track-4', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.status', { sessionID: 'ses-1', status: { type: 'busy' } }),
    })
    upstreamAt(0).onmessage!({
      data: envelope('/a', 'session.status', { sessionID: 'ses-1', status: { type: 'idle' } }),
    })
    expect(sseAggregator.getActiveDirectories()).toEqual([])
  })

  it('ignores a session status without a session id or status', () => {
    sseAggregator.start()
    sseAggregator.addClient('track-5', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({ data: envelope('/a', 'session.status', { status: { type: 'busy' } }) })
    upstreamAt(0).onmessage!({ data: envelope('/a', 'session.status', { sessionID: 'ses-1' }) })
    expect(sseAggregator.getActiveDirectories()).toEqual([])
  })

  it('ignores a session.idle without a session id', () => {
    sseAggregator.start()
    sseAggregator.addClient('track-6', () => {}, () => {}, ['/a'])
    upstreamAt(0).onmessage!({ data: envelope('/a', 'session.idle', {}) })
    expect(sseAggregator.getActiveSessions()).toEqual({})
  })

  it('exposes the scheduled session ids from the resolver', () => {
    sseAggregator.setScheduledSessionsResolver(() => [
      { sessionID: 'ses-1', directory: '/a' },
      { sessionID: 'ses-1', directory: '/b' },
      { sessionID: 'ses-2', directory: '/b' },
    ])
    expect(Array.from(sseAggregator.getScheduledSessionIds()).sort()).toEqual(['ses-1', 'ses-2'])
  })

  it('returns no scheduled session ids when no resolver is registered', () => {
    sseAggregator.setScheduledSessionsResolver(null as unknown as () => never)
    expect(sseAggregator.getScheduledSessionIds().size).toBe(0)
  })
})

describe('SSEAggregator event dispatch and broadcast', () => {
  beforeEach(resetAggregator)

  it('drops malformed and incomplete upstream payloads', () => {
    sseAggregator.start()
    const client = createCapturingClient()
    sseAggregator.addClient('evt-1', client.callback, client.writeFrame, ['/a'])

    upstreamAt(0).onmessage!({ data: 'not json' })
    upstreamAt(0).onmessage!({ data: JSON.stringify({ payload: { type: 'test', properties: {} } }) })
    upstreamAt(0).onmessage!({ data: JSON.stringify({ directory: '/a' }) })
    upstreamAt(0).onmessage!({ data: JSON.stringify({ directory: '/a', payload: { properties: {} } }) })

    expect(client.frames).toHaveLength(0)
  })

  it('notifies every event listener and keeps delivering when one throws', () => {
    sseAggregator.start()
    const client = createCapturingClient()
    sseAggregator.addClient('evt-2', client.callback, client.writeFrame, ['/a'])

    const seen: string[] = []
    sseAggregator.onEvent(() => { throw new Error('listener boom') })
    sseAggregator.onEvent((_directory, event) => seen.push(event.type))

    upstreamAt(0).onmessage!({ data: envelope('/a', 'session.idle', { sessionID: 'ses-1' }) })

    expect(seen).toEqual(['session.idle'])
    expect(client.frames).toHaveLength(1)
  })

  it('stops notifying a listener after its disposer is called', () => {
    sseAggregator.start()
    const seen: string[] = []
    const dispose = sseAggregator.onEvent((_directory, event) => seen.push(event.type))
    dispose()

    upstreamAt(0).onmessage!({ data: envelope('/a', 'session.idle', { sessionID: 'ses-1' }) })

    expect(seen).toEqual([])
  })

  it('broadcasts to every client regardless of directory subscription', () => {
    const first = createCapturingClient()
    const second = createCapturingClient()
    sseAggregator.addClient('bc-1', first.callback, first.writeFrame, ['/a'])
    sseAggregator.addClient('bc-2', second.callback, second.writeFrame, ['/b'])

    sseAggregator.broadcastToAll('message', 'payload')

    expect(first.events).toEqual([{ event: 'message', data: 'payload' }])
    expect(second.events).toEqual([{ event: 'message', data: 'payload' }])
  })

  it('broadcasts to a client with no directory subscription', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('bc-3', client.callback, client.writeFrame, [])
    sseAggregator.broadcastToAll('message', 'payload')
    expect(client.events).toHaveLength(1)
  })

  it('ignores a broadcast failure from one client', () => {
    const healthy = createCapturingClient()
    sseAggregator.addClient('bc-4', () => { throw new Error('gone') }, () => {}, [])
    sseAggregator.addClient('bc-5', healthy.callback, healthy.writeFrame, [])

    sseAggregator.broadcastToAll('message', 'payload')

    expect(healthy.events).toHaveLength(1)
  })

  it('broadcasts an ssh host key request to all clients', () => {
    const client = createCapturingClient()
    sseAggregator.addClient('ssh-1', client.callback, client.writeFrame, [])

    broadcastSSHHostKeyRequest({ host: 'example.com', port: 22, fingerprint: 'SHA256:abc' })

    expect(client.events).toHaveLength(1)
    const parsed = JSON.parse(client.events[0]?.data ?? '{}') as {
      payload: { type: string; properties: Record<string, unknown> }
    }
    expect(parsed.payload.type).toBe('ssh.host-key-request')
    expect(parsed.payload.properties).toEqual({
      host: 'example.com',
      port: 22,
      fingerprint: 'SHA256:abc',
    })
  })
})

