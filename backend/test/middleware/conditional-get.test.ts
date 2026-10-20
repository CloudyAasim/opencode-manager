import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createConditionalGetMiddleware, etagMatches } from '../../src/middleware/conditional-get'

function createApp(options: Parameters<typeof createConditionalGetMiddleware>[0] = {}) {
  const app = new Hono()
  app.use('/api/*', createConditionalGetMiddleware(options))
  app.get('/api/thing', (c) => c.json({ ok: true, value: 'same' }))
  app.get('/api/text', (c) => c.text('plain'))
  app.get('/api/big', (c) => c.json({ blob: 'x'.repeat(5000) }))
  app.get('/api/stream', (c) => {
    c.header('Content-Type', 'text/event-stream')
    return c.body(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: hello\n\n'))
          // Never closed on purpose: this is what an event stream looks like.
        },
      }),
    )
  })
  app.get('/api/no-store', (c) => {
    c.header('Cache-Control', 'no-store, no-transform')
    return c.json({ ok: true })
  })
  app.get('/api/with-etag', (c) => {
    c.header('ETag', 'W/"already-here"')
    return c.json({ ok: true })
  })
  app.get('/api/missing', (c) => c.json({ error: 'nope' }, 404))
  app.post('/api/thing', (c) => c.json({ ok: true }))
  return app
}

describe('createConditionalGetMiddleware', () => {
  it('gives a GET response a validator and a revalidating cache policy', async () => {
    const res = await createApp().request('/api/thing')

    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toMatch(/^W\/"[0-9a-f]{40}"$/)
    // `no-cache` is the point: the browser stores the body but asks the
    // server every time, so the data is never stale.
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    expect(await res.json()).toEqual({ ok: true, value: 'same' })
  })

  it('answers a matching validator with 304 and no body', async () => {
    const app = createApp()
    const first = await app.request('/api/thing')
    const etag = first.headers.get('etag')!

    const second = await app.request('/api/thing', {
      headers: { 'If-None-Match': etag },
    })

    expect(second.status).toBe(304)
    expect(second.headers.get('etag')).toBe(etag)
    expect(await second.text()).toBe('')
  })

  it('answers 304 for a strong validator that matches a weak one', async () => {
    const app = createApp()
    const first = await app.request('/api/thing')
    const etag = first.headers.get('etag')!

    const second = await app.request('/api/thing', {
      headers: { 'If-None-Match': etag.replace(/^W\//, '') },
    })

    expect(second.status).toBe(304)
  })

  it('answers 304 for a list of validators that contains the right one', async () => {
    const app = createApp()
    const first = await app.request('/api/thing')
    const etag = first.headers.get('etag')!

    const second = await app.request('/api/thing', {
      headers: { 'If-None-Match': `W/"other", ${etag}` },
    })

    expect(second.status).toBe(304)
  })

  it('answers 304 for the wildcard validator', async () => {
    const res = await createApp().request('/api/thing', {
      headers: { 'If-None-Match': '*' },
    })

    expect(res.status).toBe(304)
  })

  it('sends the body again when the validator does not match', async () => {
    const res = await createApp().request('/api/thing', {
      headers: { 'If-None-Match': 'W/"something-else"' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, value: 'same' })
  })

  it('gives different bodies different validators', async () => {
    const app = new Hono()
    app.use('/api/*', createConditionalGetMiddleware())
    app.get('/api/thing', (c) => c.json({ value: c.req.query('value') ?? 'a' }))

    const first = await app.request('/api/thing?value=a')
    const second = await app.request('/api/thing?value=b')

    expect(first.headers.get('etag')).not.toBe(second.headers.get('etag'))
  })

  it('leaves a response that already has a validator alone', async () => {
    const res = await createApp().request('/api/with-etag')

    expect(res.headers.get('etag')).toBe('W/"already-here"')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('leaves a response that says not to store anything alone', async () => {
    const res = await createApp().request('/api/no-store')

    expect(res.headers.get('etag')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store, no-transform')
  })

  it('does not validate a response that is not a success', async () => {
    const res = await createApp().request('/api/missing')

    expect(res.status).toBe(404)
    expect(res.headers.get('etag')).toBeNull()
  })

  it('does not validate a response to a request that changes state', async () => {
    const res = await createApp().request('/api/thing', { method: 'POST' })

    expect(res.headers.get('etag')).toBeNull()
  })

  it('does not touch a stream that never ends', async () => {
    // Reading an event stream to hash it would hang the response forever,
    // so the point of this test is that the request completes at all.
    const res = await createApp().request('/api/stream')

    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeNull()
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('delivers a body that is too big to validate, whole', async () => {
    const res = await createApp({ maxBodyBytes: 100 }).request('/api/big')

    // The validator is given up on, but the body must still arrive
    // complete - dropping the part that was read would send a short answer.
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBeNull()
    const body = (await res.json()) as { blob: string }
    expect(body.blob).toHaveLength(5000)
  })

  it('delivers a body that is too big to validate, byte for byte', async () => {
    const app = new Hono()
    app.use('/api/*', createConditionalGetMiddleware({ maxBodyBytes: 100 }))
    app.get('/api/thing', (c) => c.text('0123456789'.repeat(20)))

    const res = await app.request('/api/thing')
    expect(await res.text()).toBe('0123456789'.repeat(20))
  })

  it('skips the paths it was told to skip', async () => {
    const app = new Hono()
    app.use('/api/*', createConditionalGetMiddleware({ skipPrefixes: ['/api/sse/'] }))
    app.get('/api/sse/stream', (c) => c.json({ ok: true }))

    const res = await app.request('/api/sse/stream')
    expect(res.headers.get('etag')).toBeNull()
  })

  it('leaves the body it hashed unchanged', async () => {
    const app = new Hono()
    app.use('/api/*', createConditionalGetMiddleware())
    app.get('/api/thing', (c) => c.json({ text: 'ünïcödé', nested: { a: [1, 2, 3] } }))

    const res = await app.request('/api/thing')
    expect(await res.json()).toEqual({ text: 'ünïcödé', nested: { a: [1, 2, 3] } })
  })

  it('covers the OpenCode proxy, which carries the largest payloads', async () => {
    // The session list and the messages of a session come through
    // `/api/opencode`, so a change that skipped the proxy would leave the
    // biggest transfers exactly as they were.
    const app = new Hono()
    app.use('/api/*', createConditionalGetMiddleware({ skipPrefixes: ['/api/sse/', '/api/terminal/'] }))
    app.get('/api/opencode/session/ses_1/message', (c) =>
      c.json([{ info: { id: 'msg_1', role: 'assistant' }, parts: [] }]),
    )

    const first = await app.request('/api/opencode/session/ses_1/message')
    expect(first.headers.get('etag')).toMatch(/^W\/"[0-9a-f]{40}"$/)

    const second = await app.request('/api/opencode/session/ses_1/message', {
      headers: { 'If-None-Match': first.headers.get('etag')! },
    })
    expect(second.status).toBe(304)
  })
})

describe('etagMatches', () => {
  it('matches the same validator', () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true)
  })

  it('matches a strong validator against a weak one', () => {
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true)
  })

  it('does not match a different validator', () => {
    expect(etagMatches('W/"abc"', 'W/"def"')).toBe(false)
  })

  it('matches when the list contains the validator', () => {
    expect(etagMatches('W/"a", W/"abc" , W/"b"', 'W/"abc"')).toBe(true)
  })

  it('matches the wildcard', () => {
    expect(etagMatches('*', 'W/"abc"')).toBe(true)
  })
})
