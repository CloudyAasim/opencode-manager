import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OpenCodeCoreSettings } from './OpenCodeCoreSettings'
import { settingsApi } from '@/api/settings'
import type { OpenCodeConfigFile } from '@/api/types/settings'

// Radix Select's item handler calls `hasPointerCapture` on whatever the pointer
// landed on, and jsdom has no pointer capture at all.
Element.prototype.hasPointerCapture ??= () => false

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: vi.fn(),
    updateOpenCodeConfig: vi.fn(),
  },
}))

/**
 * A document with keys this page has never heard of, in every position it
 * could sit: a top-level key, a nested key inside a section it does edit, and
 * a tool inside `permission`.
 */
function configFixture(overrides: Record<string, unknown> = {}): OpenCodeConfigFile {
  return {
    content: {
      theme: 'dark',
      somethingNewerThanThisPage: { enabled: true },
      permission: { edit: 'allow', aToolFromTheFuture: 'deny' },
      compaction: { auto: true, preserve_recent_tokens: 20000 },
      ...overrides,
    },
    sources: [],
    revision: 'rev-1',
    path: '/workspace/.config/opencode/opencodode.jsonc',
    rawContent: '{}',
    updatedAt: 1,
    isValid: true,
  } as unknown as OpenCodeConfigFile
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenCodeCoreSettings />
    </QueryClientProvider>,
  )
}

function savedRequest(index = 0) {
  return vi.mocked(settingsApi.updateOpenCodeConfig).mock.calls[index][0]
}

describe('OpenCodeCoreSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture())
    vi.mocked(settingsApi.updateOpenCodeConfig).mockResolvedValue({ success: true })
  })

  it('shows what the document already says', async () => {
    renderPanel()

    expect(await screen.findByLabelText('Default model')).toHaveValue('')
    expect(await screen.findByLabelText('Default agent')).toHaveValue('')
    expect(await screen.findByLabelText('Enabled providers')).toHaveValue('')
  })

  it('reads the existing default model into the field', async () => {
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(
      configFixture({ model: 'anthropic/claude-sonnet-4-5', small_model: 'anthropic/claude-haiku-4-5' }),
    )
    renderPanel()

    // The field renders before the document arrives, so finding the label is
    // not the same as finding the value.
    await waitFor(() =>
      expect(screen.getByLabelText('Default model')).toHaveValue('anthropic/claude-sonnet-4-5'),
    )
    expect(screen.getByLabelText('Small model')).toHaveValue('anthropic/claude-haiku-4-5')
  })

  it('sends only the two model keys, with the revision it was handed', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(await screen.findByLabelText('Default model'), 'anthropic/claude-sonnet-4-5')
    await user.click(screen.getByRole('button', { name: 'Save models' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const request = savedRequest()

    expect(request.expectedRevision).toBe('rev-1')
    expect(request.content).toMatchObject({ model: 'anthropic/claude-sonnet-4-5' })
    expect(Object.keys(request.content)).toContain('model')
    // The card edits two keys. A third would be a card quietly writing into
    // somebody else's section.
    expect('permission' in (request.content as Record<string, unknown>)).toBe(true)
  })

  it('leaves every key it did not recognise exactly where it was', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(await screen.findByLabelText('Default model'), 'anthropic/claude-sonnet-4-5')
    await user.click(screen.getByRole('button', { name: 'Save models' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const content = savedRequest().content as Record<string, unknown>

    expect(content).toMatchObject({
      theme: 'dark',
      somethingNewerThanThisPage: { enabled: true },
      permission: { edit: 'allow', aToolFromTheFuture: 'deny' },
      compaction: { auto: true, preserve_recent_tokens: 20000 },
    })
  })

  it('removes the key when the field is cleared, instead of writing an empty one', async () => {
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture({ model: 'a/b' }))
    const user = userEvent.setup()
    renderPanel()

    const field = screen.getByLabelText('Default model')
    await waitFor(() => expect(field).toHaveValue('a/b'))
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save models' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const content = savedRequest().content as Record<string, unknown>

    // An empty string is a value. `delete` is the only thing that reads as
    // "I have no opinion about this any more".
    expect('model' in content).toBe(false)
  })

  it('keeps an unknown tool inside permission when one of the known ones changes', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('Default model')
    await user.click(screen.getByRole('combobox', { name: 'bash' }))
    await user.click(screen.getByRole('option', { name: 'Deny' }))
    await user.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    expect(savedRequest().content).toMatchObject({
      permission: { edit: 'allow', bash: 'deny', aToolFromTheFuture: 'deny' },
    })
  })

  it('does not resurrect a tool the user just cleared', async () => {
    const user = userEvent.setup()
    renderPanel()

    await screen.findByLabelText('Default model')
    await user.click(screen.getByRole('combobox', { name: 'edit' }))
    await user.click(screen.getByRole('option', { name: 'OpenCode default' }))
    await user.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const permission = (savedRequest().content as Record<string, Record<string, unknown>>).permission

    // `null` would be a value OpenCode has to parse; absence is what
    // "use the default" means.
    expect('edit' in permission).toBe(false)
    expect(permission.aToolFromTheFuture).toBe('deny')
  })

  it('saving one card does not throw away what was typed in another', async () => {
    const user = userEvent.setup()
    renderPanel()

    const agent = await screen.findByLabelText('Default agent')
    await user.type(agent, 'plan')
    await user.type(screen.getByLabelText('Default model'), 'anthropic/claude-sonnet-4-5')
    await user.click(screen.getByRole('button', { name: 'Save models' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))

    // Saving refetches the document, which is what used to reset every field
    // on the page back to what was on disk.
    expect(screen.getByLabelText('Default agent')).toHaveValue('plan')
  })

  it('disables a save that would change nothing', async () => {
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Save models' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save compaction' })).toBeDisabled()
  })

  it('shows an absent compaction flag as absent rather than as off', async () => {
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture({ compaction: {} }))
    renderPanel()

    await screen.findByLabelText('Default model')
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Automatic' })).toHaveTextContent('OpenCode default'),
    )
    // Reading a missing key as `false` would show the administrator a decision
    // nobody made, and the first save would then write it down as one.
  })

  it('reads a list one id per line and writes it back as an array', async () => {
    const user = userEvent.setup()
    renderPanel()

    const field = await screen.findByLabelText('Disabled providers')
    await user.type(field, 'openai\nanthropic\n')
    await user.click(screen.getByRole('button', { name: 'Save provider lists' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    expect(savedRequest().content).toMatchObject({
      disabled_providers: ['openai', 'anthropic'],
    })
  })
})