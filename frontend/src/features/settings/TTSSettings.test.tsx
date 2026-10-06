import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TTSSettings } from './TTSSettings'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useTTSModels, useTTSVoices, useTTSDiscovery } from '@/hooks/useTTSDiscovery'

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))
vi.mock('@/hooks/useTTS', () => ({ useTTS: vi.fn() }))
vi.mock('@/hooks/useDebouncedFormAutoSave', () => ({
  useDebouncedFormAutoSave: () => 'idle',
}))
vi.mock('@/lib/webSpeechSynthesizer', () => ({
  isWebSpeechSupported: () => false,
  getAvailableVoiceNames: () => [],
}))
vi.mock('@/hooks/useTTSDiscovery', () => ({
  useTTSModels: vi.fn(),
  useTTSVoices: vi.fn(),
  useTTSDiscovery: vi.fn(),
}))

const updateSettingsAsync = vi.fn()
const speakWithConfig = vi.fn()

const SAVED = {
  enabled: true,
  provider: 'external' as const,
  autoPlay: false,
  endpoint: 'https://relay.example.com/v1',
  apiKey: 'sk-saved',
  voice: 'alloy',
  model: 'tts-1',
  speed: 1,
  availableVoices: [],
  availableModels: [],
  lastVoicesFetch: 0,
  lastModelsFetch: 0,
}

const testButton = () => screen.getByRole('button', { name: /test|stop|testing/i })

describe('TTSSettings test button', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    updateSettingsAsync.mockResolvedValue(undefined)
    speakWithConfig.mockResolvedValue(true)

    vi.mocked(useSettings).mockReturnValue({
      preferences: { tts: SAVED },
      updateSettings: vi.fn(),
      updateSettingsAsync,
    } as unknown as ReturnType<typeof useSettings>)

    vi.mocked(useTTS).mockReturnValue({
      speakWithConfig,
      stop: vi.fn(),
      isPlaying: false,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTTS>)

    vi.mocked(useTTSModels).mockReturnValue({
      data: { models: ['tts-1'], cached: false, source: 'discovered' },
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTTSModels>)
    vi.mocked(useTTSVoices).mockReturnValue({
      data: { voices: ['alloy'], cached: false, source: 'discovered' },
      isLoading: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useTTSVoices>)
    vi.mocked(useTTSDiscovery).mockReturnValue({
      refreshModels: vi.fn(),
      refreshVoices: vi.fn(),
      refreshAll: vi.fn(),
    } as unknown as ReturnType<typeof useTTSDiscovery>)
  })

  it('persists what was just typed before asking the server to speak', async () => {
    // The bug this is about: /synthesize reads persisted settings while the
    // panel sends the live form, with an 800ms debounce in between. Clicking
    // straight after editing made the server answer about the *previous* save,
    // which surfaced as "TTS is not enabled" for a switch that was plainly on.
    let releaseSave: () => void = () => {}
    updateSettingsAsync.mockImplementation(
      () => new Promise<void>((resolve) => { releaseSave = () => resolve() }),
    )
    const user = userEvent.setup()
    render(<TTSSettings />)

    await user.click(testButton())

    await waitFor(() => expect(updateSettingsAsync).toHaveBeenCalledTimes(1))
    // The save is in flight and nothing has reached the backend yet. This is an
    // assertion on completion, not on invocation order - a save that is fired
    // but not awaited still records an earlier call order, so ordering alone
    // would pass with the race back in place.
    expect(speakWithConfig).not.toHaveBeenCalled()

    releaseSave()
    await waitFor(() => expect(speakWithConfig).toHaveBeenCalledTimes(1))

    expect(speakWithConfig).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ enabled: true, endpoint: 'https://relay.example.com/v1' }),
    )
  })

  it('still speaks when persisting the draft fails', async () => {
    updateSettingsAsync.mockRejectedValue(new Error('save failed'))
    const user = userEvent.setup()
    render(<TTSSettings />)

    await user.click(testButton())

    await waitFor(() => expect(speakWithConfig).toHaveBeenCalledTimes(1))
  })

  it.each([
    ['the endpoint', { endpoint: '' }],
    ['the model', { model: '' }],
    ['the voice', { voice: '' }],
    ['the API key', { apiKey: '' }],
  ])('does not offer a test while %s is blank', async (_field, override) => {
    // Each of these is something /synthesize rejects. Offering the button with
    // one of them missing is what makes a 400 about the wrong field reachable
    // in the first place.
    vi.mocked(useSettings).mockReturnValue({
      preferences: { tts: { ...SAVED, ...override } },
      updateSettings: vi.fn(),
      updateSettingsAsync,
    } as unknown as ReturnType<typeof useSettings>)

    render(<TTSSettings />)

    expect(testButton()).toBeDisabled()
    // let the panel's mount effects settle so no update lands outside act
    await act(async () => {})
  })
})
