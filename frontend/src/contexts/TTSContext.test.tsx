import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TTSProvider } from './TTSContext'
import { useTTS } from '@/hooks/useTTS'
import type { TTSConfig } from './tts-context'
import { useSettings } from '@/hooks/useSettings'

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))

vi.mock('@/lib/webSpeechSynthesizer', () => ({
  getWebSpeechSynthesizer: () => ({ speak: vi.fn(), cancel: vi.fn() }),
  isWebSpeechSupported: () => false,
}))

const CONFIG: TTSConfig = {
  enabled: true,
  provider: 'external',
  endpoint: 'https://relay.example.com',
  apiKey: 'sk-test',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1,
}

function Probe() {
  const { speakWithConfig, error } = useTTS()
  return (
    <div>
      <button onClick={() => void speakWithConfig('Hello there', CONFIG)}>speak</button>
      <div data-testid="tts-error">{error ?? ''}</div>
    </div>
  )
}

function renderProvider() {
  return render(
    <TTSProvider>
      <Probe />
    </TTSProvider>,
  )
}

describe('TTS error reporting reaches the user', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.mocked(useSettings).mockReturnValue({
      preferences: { tts: CONFIG },
    } as unknown as ReturnType<typeof useSettings>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    global.fetch = originalFetch
  })

  it('shows the relay\'s own words and status, not just the backend label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'TTS API request failed',
        details: 'The model `tts-1` does not exist or you do not have access',
        upstreamStatus: 404,
        upstreamBody: '{"error":{"message":"The model `tts-1` does not exist"}}',
      }),
    }))

    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'speak' }))

    const shown = await screen.findByTestId('tts-error')
    await waitFor(() => expect(shown.textContent).not.toBe(''))

    // the whole point of the fix: the provider's message, and the status
    expect(shown.textContent).toContain('does not exist')
    expect(shown.textContent).toContain('404')
    // and not the bare label that used to be all the user ever got
    expect(shown.textContent).not.toBe('TTS API request failed')
  })

  it('still names the status when the backend sent no evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    }))

    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'speak' }))

    const shown = await screen.findByTestId('tts-error')
    await waitFor(() => expect(shown.textContent).toContain('429'))
  })

  it('rejects a 200 that is not audio instead of playing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      blob: async () => new Blob(['{"error":"no such model"}'], { type: 'application/json' }),
    }))

    const user = userEvent.setup()
    renderProvider()
    await user.click(screen.getByRole('button', { name: 'speak' }))

    const shown = await screen.findByTestId('tts-error')
    await waitFor(() => expect(shown.textContent).toContain('Invalid response from TTS service'))
  })
})
