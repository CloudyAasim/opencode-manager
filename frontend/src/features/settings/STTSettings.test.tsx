import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { STTSettings } from './STTSettings'
import { useSettings } from '@/hooks/useSettings'
import { useSTT } from '@/hooks/useSTT'
import { sttApi } from '@/api/stt'

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))
vi.mock('@/hooks/useSTT', () => ({ useSTT: vi.fn() }))

vi.mock('@/hooks/useDebouncedFormAutoSave', () => ({
  useDebouncedFormAutoSave: () => 'idle',
}))

vi.mock('@/lib/webSpeechRecognizer', () => ({
  isWebRecognitionSupported: () => false,
  getAvailableLanguages: () => [],
}))

vi.mock('@/api/stt', () => ({
  sttApi: { getModels: vi.fn().mockResolvedValue({ models: [] }) },
}))

const SAVED_KEY = 'sk-stt-9f2b7c-do-not-leak'

function mockPreferences(stt: Record<string, unknown>) {
  vi.mocked(useSettings).mockReturnValue({
    preferences: {
      stt: {
        enabled: true,
        provider: 'external',
        endpoint: 'https://api.openai.com',
        apiKey: SAVED_KEY,
        model: 'whisper-1',
        language: 'en-US',
        ...stt,
      },
    },
    updateSettings: vi.fn(),
  } as unknown as ReturnType<typeof useSettings>)
}

// Located through the form item rather than through the label's `for` id. The
// old markup put that id on a wrapper <div>, and a test that dies with
// "non-labellable" is testing markup instead of masking. A structural lookup
// finds the field in both markups, so a failure here is about the key.
const apiKeyFormItem = () => {
  const item = screen.getByText('API Key').closest('div.space-y-2')
  expect(item).not.toBeNull()
  return item as HTMLElement
}

const apiKeyField = () => {
  const input = apiKeyFormItem().querySelector('input')
  expect(input).not.toBeNull()
  return input as HTMLInputElement
}

// The panel probes the endpoint for a model list a beat after mount, which
// lands as a state update. Settle it inside act so it is not an open timer by
// the time the test ends.
const modelProbeSettled = () =>
  waitFor(() => expect(sttApi.getModels).toHaveBeenCalled())

describe('STTSettings API key field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSTT).mockReturnValue({
      startRecording: vi.fn().mockResolvedValue(true),
      stopRecording: vi.fn(),
      abortRecording: vi.fn(),
      reset: vi.fn(),
      isRecording: false,
      isProcessing: false,
      isError: false,
      error: null,
      transcript: '',
      interimTranscript: '',
      state: 'idle',
      isEnabled: true,
      isSupported: false,
      isExternalProvider: true,
    } as unknown as ReturnType<typeof useSTT>)
    mockPreferences({})
  })

  it('masks a key that is already saved, instead of showing it back in clear text', async () => {
    render(<STTSettings />)

    const field = apiKeyField()
    expect(field).toHaveAttribute('type', 'password')
    // still the real value, just not readable on screen
    expect(field).toHaveValue(SAVED_KEY)

    await modelProbeSettled()
  })

  it('keeps masking a key the user types in', async () => {
    const user = userEvent.setup()
    render(<STTSettings />)

    const field = apiKeyField()
    await user.clear(field)
    await user.type(field, 'sk-brand-new-key')

    expect(field).toHaveValue('sk-brand-new-key')
    expect(field).toHaveAttribute('type', 'password')

    await modelProbeSettled()
  })

  it('offers no control in the key field that can switch it to readable text', async () => {
    render(<STTSettings />)

    // The eye toggle that used to sit in this field is the whole bug: a saved
    // key stayed one click away from clear text. A future edit that puts any
    // button here has to fail this first.
    expect(apiKeyFormItem().querySelectorAll('button')).toHaveLength(0)

    await modelProbeSettled()
  })
})
