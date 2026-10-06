import { describe, it, expect } from 'vitest'
import { formatUpstreamFailure } from './upstream-error'

describe('formatUpstreamFailure', () => {
  it('puts the upstream status and the relay\'s own words in the message', () => {
    const msg = formatUpstreamFailure(
      {
        error: 'TTS API request failed',
        details: 'The model `gpt-4o-mini-tts` does not exist',
        upstreamStatus: 404,
        upstreamBody: '{"error":{"message":"The model `gpt-4o-mini-tts` does not exist"}}',
      },
      500,
      'TTS request failed',
    )

    expect(msg).toContain('TTS API request failed')
    expect(msg).toContain('404')
    expect(msg).toContain('The model `gpt-4o-mini-tts` does not exist')
  })

  it('never lets the constant label hide the status code', () => {
    // The regression this whole function exists for: `error` is always truthy,
    // so the old `error || details || fallback` chain always stopped at it and
    // the user was told nothing beyond a fixed string.
    const msg = formatUpstreamFailure(
      { error: 'STT API request failed', details: 'Unauthorized', upstreamStatus: 401 },
      401,
      'STT API request failed',
    )

    expect(msg).toContain('401')
    expect(msg).toContain('Unauthorized')
  })

  it('falls back to upstreamBody when details is missing', () => {
    const msg = formatUpstreamFailure(
      { error: 'STT API request failed', upstreamStatus: 500, upstreamBody: '502 Bad Gateway' },
      500,
      'STT API request failed',
    )

    expect(msg).toContain('502 Bad Gateway')
    expect(msg).toContain('500')
  })

  it('shows the body once when details is just the raw body', () => {
    const body = 'not found'
    const msg = formatUpstreamFailure(
      { error: 'TTS API request failed', details: body, upstreamBody: body, upstreamStatus: 404 },
      404,
      'TTS request failed',
    )

    expect(msg.match(/not found/g)).toHaveLength(1)
  })

  it('still reports the status when the backend sent no evidence at all', () => {
    const msg = formatUpstreamFailure({ error: 'TTS API request failed' }, 503, 'TTS request failed')

    expect(msg).toBe('TTS API request failed (HTTP 503)')
  })

  it('copes with a null payload and odd field types', () => {
    expect(formatUpstreamFailure(null, 500, 'Transcription failed')).toBe('Transcription failed (HTTP 500)')
    expect(
      formatUpstreamFailure({ details: 42, upstreamStatus: 'x' } as never, 429, 'rate limited'),
    ).toBe('rate limited (HTTP 429)')
  })
})
