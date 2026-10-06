import { describe, it, expect } from 'vitest'
import { describeUpstreamFailure, truncateUpstreamBody } from '../../src/utils/upstream-error'

describe('truncateUpstreamBody', () => {
  it('leaves a short body alone', () => {
    expect(truncateUpstreamBody('  {"message":"nope"}  ')).toBe('{"message":"nope"}')
  })

  it('cuts a long body and says how long it really was', () => {
    const long = 'x'.repeat(900)
    const out = truncateUpstreamBody(long)

    expect(out.startsWith('x'.repeat(500))).toBe(true)
    expect(out).toContain('truncated, 900 chars total')
    expect(out.length).toBeLessThan(long.length)
  })
})

describe('describeUpstreamFailure', () => {
  // Relays answer in every one of these shapes, and which one you get tells you
  // which provider is in front of you. All of them have to survive.
  const messageShapes: Array<[string, string, string]> = [
    ['detail.error.message', '{"detail":{"error":{"message":"model not found"}}}', 'model not found'],
    ['detail.message', '{"detail":{"message":"bad model"}}', 'bad model'],
    ['error.message', '{"error":{"message":"invalid api key"}}', 'invalid api key'],
    ['error as string', '{"error":"quota exceeded"}', 'quota exceeded'],
    ['message', '{"message":"voice unknown"}', 'voice unknown'],
  ]

  it.each(messageShapes)('extracts a message from %s', (_name, body, expected) => {
    const result = describeUpstreamFailure({ error: 'TTS API request failed', status: 400, body })

    expect(result.details).toBe(expected)
    expect(result.detailsIsRawBody).toBe(false)
    expect(result.upstreamStatus).toBe(400)
    expect(result.upstreamBody).toBe(body)
  })

  it('keeps the untouched body even when a message was extracted', () => {
    const body = '{"detail":{"error":{"message":"model not found"}},"code":"model_missing"}'
    const result = describeUpstreamFailure({ error: 'TTS API request failed', status: 404, body })

    expect(result.details).toBe('model not found')
    expect(result.upstreamBody).toBe(body)
    expect(result.upstreamStatus).toBe(404)
  })

  it('falls back to the raw body when the relay answers with a non-JSON error page', () => {
    const body = '<html><head><title>404 Not Found</title></head></html>'
    const result = describeUpstreamFailure({ error: 'TTS API request failed', status: 404, body })

    expect(result.details).toBe(body)
    expect(result.detailsIsRawBody).toBe(true)
    expect(result.upstreamStatus).toBe(404)
  })

  it('does not mistake an object-valued error field for a message', () => {
    const result = describeUpstreamFailure({
      error: 'TTS API request failed',
      status: 500,
      body: '{"error":{"code":500}}',
    })

    expect(result.details).toBe('{"error":{"code":500}}')
    expect(result.detailsIsRawBody).toBe(true)
  })

  it('survives an empty body', () => {
    const result = describeUpstreamFailure({ error: 'TTS API request failed', status: 502, body: '' })

    expect(result.details).toBe('')
    expect(result.upstreamBody).toBe('')
    expect(result.upstreamStatus).toBe(502)
  })

  it('truncates the body it carries back', () => {
    const result = describeUpstreamFailure({
      error: 'TTS API request failed',
      status: 500,
      body: 'y'.repeat(2000),
    })

    expect(result.upstreamBody.length).toBeLessThan(700)
    expect(result.upstreamBody).toContain('truncated, 2000 chars total')
  })
})
