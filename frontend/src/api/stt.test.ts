import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sttApi } from './stt'
import { FetchError } from './fetchWrapper'

describe('WAV extension selection logic', () => {
  const originalFetch = global.fetch
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  const createMockResponse = (ok = true, data = {}) => {
    return new Response(JSON.stringify(data), {
      status: ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('should return wav for audio/wav blob', async () => {
    const blob = new Blob([], { type: 'audio/wav' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.wav')
  })

  it('should return webm for audio/webm blob', async () => {
    const blob = new Blob([], { type: 'audio/webm' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.webm')
  })

  it('should return ogg for audio/ogg blob', async () => {
    const blob = new Blob([], { type: 'audio/ogg' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.ogg')
  })

  it('should return m4a for audio/mp4 blob', async () => {
    const blob = new Blob([], { type: 'audio/mp4' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.m4a')
  })

  it('should return webm for audio/webm;codecs=opus blob', async () => {
    const blob = new Blob([], { type: 'audio/webm;codecs=opus' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.webm')
  })

  it('should default to wav for unknown types', async () => {
    const blob = new Blob([], { type: 'audio/unknown' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.wav')
  })

  it('should prioritize wav over webm when both present', async () => {
    const blob = new Blob([], { type: 'audio/wav;codecs=pcm' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'test' }))

    await sttApi.transcribe(blob)

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    const audioFile = formData.get('audio') as File
    expect(audioFile.name).toBe('recording.wav')
  })

  it('must NOT name a tenant in the request URL', async () => {
    // The STT routes resolve their owner from the session. While they honoured
    // `?userId=` the panel was writing one user and asking about another, which
    // is why an enabled, saved, correctly configured STT never transcribed.
    const blob = new Blob([], { type: 'audio/webm' })
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) })

    await sttApi.transcribe(blob)

    const url = String(mockFetch.mock.calls[0][0])
    expect(url).toContain('/api/stt/transcribe')
    expect(url).not.toContain('userId')
  })

  it('should send FormData with audio file', async () => {
    const blob = new Blob(['audio data'], { type: 'audio/wav' })
    mockFetch.mockResolvedValueOnce(createMockResponse(true, { text: 'transcribed text' }))

    await sttApi.transcribe(blob)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stt/transcribe'),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      })
    )

    const callArgs = mockFetch.mock.calls[0]
    const formData = callArgs[1]?.body as FormData
    expect(formData.get('audio')).toBeInstanceOf(File)
  })
})

describe('sttApi.transcribe cancellation and timeout', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('throws 499 CANCELED when caller aborts', async () => {
    const blob = new Blob([], { type: 'audio/webm;codecs=opus' })
    const abortController = new AbortController()

    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })

    const promise = sttApi.transcribe(blob, abortController.signal)

    abortController.abort()

    await expect(promise).rejects.toThrow(FetchError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 499,
      code: 'CANCELED',
    })
  })

  it('throws 408 TIMEOUT when transcription times out', async () => {
    vi.useFakeTimers()

    const blob = new Blob([], { type: 'audio/webm;codecs=opus' })

    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    })

    const promise = sttApi.transcribe(blob)

    vi.advanceTimersByTime(60000)

    await expect(promise).rejects.toThrow(FetchError)
    await expect(promise).rejects.toMatchObject({
      statusCode: 408,
      code: 'TIMEOUT',
    })

    vi.useRealTimers()
  })
})

describe('sttApi.transcribe error reporting', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('surfaces the relay\'s own message and status, not a fixed string', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'STT API request failed',
        details: 'no such endpoint: /v1/audio/transcriptions',
        upstreamStatus: 404,
        upstreamBody: '{"error":{"message":"no such endpoint"}}',
      }),
    })

    const promise = sttApi.transcribe(new Blob([], { type: 'audio/webm' }))

    await expect(promise).rejects.toThrow(/404/)
    await expect(promise).rejects.toThrow(/no such endpoint/)
    await expect(promise).rejects.not.toThrow(/^STT API request failed$/)
  })

  it('reports the status even when the backend sent no details', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => null,
    })

    await expect(sttApi.transcribe(new Blob([]))).rejects.toThrow(/HTTP 429/)
  })
})
