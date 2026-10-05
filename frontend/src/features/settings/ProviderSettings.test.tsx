import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProviderSettings } from './ProviderSettings'
import { getProviders, providerCredentialsApi } from '@/api/providers'
import { oauthApi } from '@/api/oauth'
import { settingsApi } from '@/api/settings'
import type { Provider, Model } from '@/api/providers'
import type { OAuthAuthorizeResponse } from '@/api/oauth'
import type { OpenCodeConfigFile } from '@/api/types/settings'
import type { ReactNode } from 'react'
import { showErrorToast } from '@/lib/error-toast'

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getOpenCodeConfig: vi.fn(),
    updateOpenCodeConfig: vi.fn(),
  },
}))

vi.mock('@/api/providers', () => ({
  getProviders: vi.fn(),
  providerCredentialsApi: {
    list: vi.fn(),
    getStatus: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

vi.mock('@/api/oauth', () => ({
  oauthApi: {
    getAuthMethods: vi.fn(),
    authorize: vi.fn(),
    callback: vi.fn(),
  },
}))

vi.mock('./OAuthAuthorizeDialog', () => ({
  OAuthAuthorizeDialog: ({
    open,
    providerId,
  }: {
    open: boolean
    providerId: string
    providerName: string
    methods: unknown[]
    onOpenChange: (open: boolean) => void
    onSuccess: (response: OAuthAuthorizeResponse, methodIndex: number) => void
  }) => (open ? <div data-testid="oauth-authorize-dialog">{providerId}</div> : null),
}))

vi.mock('./OAuthCallbackDialog', () => ({
  OAuthCallbackDialog: ({
    open,
    providerId,
  }: {
    open: boolean
    providerId: string
    providerName: string
    authResponse: OAuthAuthorizeResponse
    methodIndex: number
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
  }) => (open ? <div data-testid="oauth-callback-dialog">{providerId}</div> : null),
}))

vi.mock('@/features/settings/ApiKeyDialog', () => ({
  ApiKeyDialog: ({
    open,
    mode,
    provider,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    provider: { id: string; name: string; models: { id: string; name: string }[] }
    onSuccess: () => void
    mode: 'add' | 'edit'
  }) => (open ? <div data-testid="api-key-dialog" data-mode={mode}>{provider.name}</div> : null),
}))

vi.mock('@/components/ui/delete-dialog', () => ({
  DeleteDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    onCancel: () => void
    title: string
    description: ReactNode
    isDeleting: boolean
  }) => (open ? <button onClick={onConfirm}>Confirm delete</button> : null),
}))

function providerFixture(id: string, name: string, modelCount: number): Provider {
  return {
    id,
    name,
    env: [],
    models: Object.fromEntries(
      Array.from({ length: modelCount }, (_, index) => [`model-${index}`, {} as Model]),
    ),
  }
}

const oauthProviderWithKey = providerFixture('anthropic', 'Anthropic', 2)
const oauthProviderWithoutKey = providerFixture('google', 'Google', 3)
const apiKeyProviderWithKey = providerFixture('openai', 'OpenAI', 1)
const apiKeyProviderWithoutKey = providerFixture('together', 'Together AI', 4)

function configFixture(providers: Record<string, unknown> = { openai: { name: 'OpenAI' } }): OpenCodeConfigFile {
  return {
    content: { theme: 'dark', provider: providers },
    sources: [],
    revision: 'rev-1',
    path: '/workspace/.config/opencode/opencodode.jsonc',
    rawContent: '{}',
    updatedAt: 1,
    isValid: true,
  } as unknown as OpenCodeConfigFile
}

function mockProviderData() {
  vi.mocked(getProviders).mockResolvedValue({
    providers: [
      oauthProviderWithKey,
      oauthProviderWithoutKey,
      apiKeyProviderWithKey,
      apiKeyProviderWithoutKey,
    ],
    connected: [],
    default: {},
  })
  vi.mocked(providerCredentialsApi.list).mockResolvedValue(['anthropic', 'openai'])
  vi.mocked(oauthApi.getAuthMethods).mockResolvedValue({
    anthropic: [{ type: 'oauth', label: 'OAuth' }],
    google: [{ type: 'oauth', label: 'OAuth' }],
  })
  vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture())
  vi.mocked(settingsApi.updateOpenCodeConfig).mockResolvedValue(configFixture())
}

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProviderSettings />
    </QueryClientProvider>,
  )
}

describe('ProviderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderData()
  })

  it('lays out OAuth and API key columns in a container-query grid that splits at 1000px of content width', async () => {
    const { container } = renderSettings()

    await screen.findByText('Anthropic')

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('@container', 'w-full', 'max-w-7xl')

    const layout = root.firstElementChild as HTMLElement
    expect(layout).toHaveClass('grid', '@min-[1000px]:grid-cols-2', '@min-[1000px]:items-start')

    const [oauthColumn, apiKeysColumn] = Array.from(layout.children) as HTMLElement[]
    expect(oauthColumn).toHaveClass('min-w-0')
    expect(within(oauthColumn).getByRole('heading', { name: 'OAuth Providers' })).toBeInTheDocument()
    expect(apiKeysColumn).toHaveClass('min-w-0')
    expect(within(apiKeysColumn).getByRole('heading', { name: 'API Keys' })).toBeInTheDocument()
  })

  it('renders OAuth providers as compact divider rows with the name, model count, status, and actions', async () => {
    const { container } = renderSettings()

    await screen.findByText('Anthropic')

    const rows = container.querySelector('.divide-y') as HTMLElement
    expect(rows).toHaveClass('divide-border')

    const connectedRow = screen.getByText('Anthropic').closest('.py-3') as HTMLElement
    expect(connectedRow).toHaveClass('flex-wrap')
    expect(within(connectedRow).getByText('2 models')).toBeInTheDocument()
    expect(within(connectedRow).getByText('Connected')).toBeInTheDocument()
    expect(within(connectedRow).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(within(connectedRow).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()

    const disconnectedRow = screen.getByText('Google').closest('.py-3') as HTMLElement
    expect(within(disconnectedRow).getByText('3 models')).toBeInTheDocument()
    expect(within(disconnectedRow).getByText('Not Connected')).toBeInTheDocument()
    expect(within(disconnectedRow).getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(within(disconnectedRow).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
  })

  it('expands Available Providers by default so the search is visible immediately', async () => {
    renderSettings()

    await screen.findByText('Together AI')

    expect(screen.getByPlaceholderText('Search providers...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Available Providers/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Connected/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the Connected disclosure collapsed and labels its icon-only key actions', async () => {
    const user = userEvent.setup()
    const { container } = renderSettings()

    await screen.findByText('Anthropic')

    // Scoped to the API keys sub-section on purpose: the custom-provider
    // section above it legitimately renders a provider called OpenAI whenever
    // the config declares one, so a document-wide "is OpenAI on the page" says
    // nothing about whether this disclosure is collapsed.
    const apiKeysColumn = (container.firstElementChild?.firstElementChild?.children[1]) as HTMLElement
    const apiKeysSection = apiKeysColumn.querySelector('.border-t') as HTMLElement
    expect(apiKeysSection).toBeInTheDocument()
    expect(within(apiKeysSection).queryByText('OpenAI')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Connected/ }))

    const connectedCard = within(apiKeysSection).getByText('OpenAI').closest('.bg-card') as HTMLElement
    expect(within(connectedCard).getByRole('button', { name: 'Edit API key for OpenAI' })).toBeInTheDocument()
    expect(within(connectedCard).getByRole('button', { name: 'Remove credentials for OpenAI' })).toBeInTheDocument()
  })

  it('filters the available provider search list and gives it the taller scroll area', async () => {
    const user = userEvent.setup()
    const { container } = renderSettings()

    await screen.findByText('Together AI')

    const list = container.querySelector('.max-h-96') as HTMLElement
    expect(list).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Search providers...'), 'together')

    expect(within(list).getByText('Together AI')).toBeInTheDocument()
    expect(within(list).queryByText('OpenAI')).not.toBeInTheDocument()
  })

  it('opens the OAuth authorize dialog when Connect is chosen', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Google')

    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(screen.getByTestId('oauth-authorize-dialog')).toHaveTextContent('google')
  })

  it('opens the API key dialog in add mode from the available list', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Together AI')

    await user.click(screen.getByRole('button', { name: 'Add Key' }))

    const dialog = screen.getByTestId('api-key-dialog')
    expect(dialog).toHaveAttribute('data-mode', 'add')
    expect(dialog).toHaveTextContent('Together AI')
  })

  it('opens the API key dialog in edit mode from the connected list', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic')

    await user.click(screen.getByRole('button', { name: /Connected/ }))
    await user.click(screen.getByRole('button', { name: 'Edit API key for OpenAI' }))

    const dialog = screen.getByTestId('api-key-dialog')
    expect(dialog).toHaveAttribute('data-mode', 'edit')
    expect(dialog).toHaveTextContent('OpenAI')
  })

  it('removes credentials through the confirm dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(providerCredentialsApi.delete).mockResolvedValue(undefined)
    renderSettings()

    await screen.findByText('Anthropic')

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(providerCredentialsApi.delete).toHaveBeenCalledWith('anthropic')
    })
  })

  it('shows the empty state when no OAuth-capable providers exist', async () => {
    vi.mocked(oauthApi.getAuthMethods).mockResolvedValue({})
    renderSettings()

    await screen.findByText('No OAuth-capable providers available.')

    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
  })

  it('keeps the confirm dialog open and says so when the delete fails', async () => {
    const user = userEvent.setup()
    vi.mocked(providerCredentialsApi.delete).mockRejectedValue(new Error('nope'))
    renderSettings()

    await screen.findByText('Anthropic')

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    // still there: a failed delete must not look like a completed one
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
    expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBe('Could not remove the credentials')
  })

  it('closes the confirm dialog once the delete lands', async () => {
    const user = userEvent.setup()
    vi.mocked(providerCredentialsApi.delete).mockResolvedValue(undefined)
    renderSettings()

    await screen.findByText('Anthropic')

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
    })
  })
})

/**
 * Declaring a provider is a config edit. Manager has no provider catalogue of
 * its own - the list this page renders is whatever OpenCode reports - so these
 * cases are about what lands in the OpenCode config and nothing else.
 *
 * The dialog itself is stubbed: its form is covered by its own test file, and
 * what matters here is the wiring - which ids the page offers, which draft goes
 * up, and what a refusal does.
 */
vi.mock('./CustomProviderDialog', () => ({
  CustomProviderDialog: ({
    open,
    onOpenChange,
    onSubmit,
    editingProviderId,
    initialDraft,
    existingProviderIds,
    error,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (draft: unknown) => void
    editingProviderId?: string
    initialDraft?: { name: string; models: unknown[] } | undefined
    existingProviderIds: string[]
    error?: string | null
  }) =>
    open ? (
      <div
        data-testid="custom-provider-dialog"
        data-editing={editingProviderId ?? ''}
        data-ids={existingProviderIds.join(',')}
      >
        <span data-testid="draft-name">{initialDraft?.name ?? ''}</span>
        <span data-testid="draft-models">{initialDraft?.models.length ?? 0}</span>
        {error && <span data-testid="dialog-error">{error}</span>}
        <button
          onClick={() =>
            onSubmit({
              providerId: 'my-provider',
              name: 'My Provider',
              kind: 'api',
              baseUrl: 'https://example.com/v1',
              npm: '',
              models: [
                {
                  id: 'my-model',
                  name: 'My Model',
                  family: '',
                  status: '',
                  releaseDate: '',
                  contextLimit: '128000',
                  inputLimit: '',
                  outputLimit: '16384',
                  temperature: true,
                  reasoning: true,
                  attachment: false,
                  toolcall: true,
                  inputModalities: { text: true, audio: false, image: true, video: false, pdf: false },
                  outputModalities: { text: true, audio: false, image: false, video: false, pdf: false },
                  interleaved: 'none',
                  costInput: '2.5',
                  costOutput: '10',
                  costCacheRead: '',
                  costCacheWrite: '',
                  variants: [{ name: 'high', reasoningEffort: 'high', extraJson: '' }],
                  headers: [],
                  optionsJson: '',
                },
              ],
            })
          }
        >
          Submit provider
        </button>
        <button onClick={() => onOpenChange(false)}>Close provider dialog</button>
      </div>
    ) : null,
}))

const DECLARED = {
  mine: {
    name: 'Mine',
    api: 'https://example.com/v1',
    options: { baseURL: 'https://example.com/v1' },
    models: { 'gpt-4o': { name: 'GPT-4o' }, 'gpt-4o-mini': { name: 'GPT-4o mini' } },
  },
  openai: { name: 'OpenAI' },
}

describe('ProviderSettings — the custom provider section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderData()
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture(DECLARED))
  })

  it('puts the section in the providers column, above the API keys it belongs with', async () => {
    const { container } = renderSettings()

    await screen.findByText('Together AI')

    const rightColumn = (container.firstElementChild?.firstElementChild?.children[1]) as HTMLElement
    expect(within(rightColumn).getByRole('heading', { name: 'Custom providers' })).toBeInTheDocument()
    expect(within(rightColumn).getByRole('heading', { name: 'API Keys' })).toBeInTheDocument()
  })

  it('lists what the config declares, with its model count and whether a key is attached', async () => {
    renderSettings()

    await screen.findByText('Mine')

    expect(screen.getByText('mine')).toBeInTheDocument()
    expect(screen.getByText('2 models declared')).toBeInTheDocument()
    // Nothing in the credential list for this id, so the row has to say so
    // rather than leave a blank where a status would go.
    expect(screen.getByText('No key attached')).toBeInTheDocument()
    // The section is about declared providers, not the catalogue the rest of
    // the page lists, so the two must not bleed into each other.
    expect(screen.getByRole('button', { name: 'Edit OpenAI' })).toBeInTheDocument()
  })

  it('says so when nothing has been declared', async () => {
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture({}))
    renderSettings()

    await screen.findByText('No custom providers yet')

    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })

  it('opens a blank editor for a create, with every declared id offered as taken', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'New custom provider' }))

    const dialog = screen.getByTestId('custom-provider-dialog')
    expect(dialog).toHaveAttribute('data-editing', '')
    expect(dialog).toHaveAttribute('data-ids', 'mine,openai')
    expect(screen.getByTestId('draft-name')).toHaveTextContent('')
    expect(screen.getByTestId('draft-models')).toHaveTextContent('0')
  })

  it('opens the stored declaration for an edit, rather than a blank form', async () => {
    // A create-shaped editor for an existing provider is how a save silently
    // replaces it with an empty one.
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'Edit Mine' }))

    const dialog = screen.getByTestId('custom-provider-dialog')
    expect(dialog).toHaveAttribute('data-editing', 'mine')
    expect(screen.getByTestId('draft-name')).toHaveTextContent('Mine')
    expect(screen.getByTestId('draft-models')).toHaveTextContent('2')
  })

  it('writes the whole declaration, limits and capabilities included', async () => {
    // The point of the rewrite: a model with a name and nothing else leaves
    // `limit.context` and `capabilities.*` undefined, and the rest of the app
    // reads them without a guard.
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const request = vi.mocked(settingsApi.updateOpenCodeConfig).mock.calls[0][0]

    expect(request.expectedRevision).toBe('rev-1')
    expect(request.content).toMatchObject({
      theme: 'dark',
      provider: {
        'my-provider': {
          name: 'My Provider',
          api: 'https://example.com/v1',
          options: { baseURL: 'https://example.com/v1' },
          models: {
            'my-model': {
              limit: { context: 128000, output: 16384 },
              capabilities: {
                reasoning: true,
                toolcall: true,
                input: { text: true, image: true },
              },
              cost: { input: 2.5, output: 10 },
              variants: { high: { reasoningEffort: 'high' } },
            },
          },
        },
      },
    })
    // No key travels with the declaration; the user sets it in the next step.
    expect(JSON.stringify(request.content)).not.toContain('apiKey')
  })

  it('sends the merged content, not just the changed key', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalled())
    const content = vi.mocked(settingsApi.updateOpenCodeConfig).mock.calls[0][0].content

    // Sending only the new key would read, against the merged view, as a
    // removal of everything else and trip the shadowed-removal guard.
    expect(content).toHaveProperty('provider.mine')
    expect(content).toHaveProperty('provider.openai')
    expect(content).toHaveProperty('theme', 'dark')
  })

  it('takes a provider out of the config, leaving the others alone', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'Remove Mine' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const content = vi.mocked(settingsApi.updateOpenCodeConfig).mock.calls[0][0].content
    expect(content).toHaveProperty('provider.openai')
    expect(content).not.toHaveProperty('provider.mine')
    expect(content).toHaveProperty('theme', 'dark')
  })

  it('re-reads the provider list after a change, so the row updates', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    const before = vi.mocked(getProviders).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Remove Mine' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    // Not asserted on an invalidation helper being called: what matters is that
    // the list this page renders is asked for again, since it is OpenCode's
    // answer and OpenCode has not reloaded yet.
    await waitFor(() => {
      expect(vi.mocked(getProviders).mock.calls.length).toBeGreaterThan(before)
    })
  })

  it('closes the editor once the write lands', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => {
      expect(screen.queryByTestId('custom-provider-dialog')).not.toBeInTheDocument()
    })
  })

  it('keeps the editor open with the failure in it when the write fails', async () => {
    // A failed write that looks like a successful one is the failure mode that
    // matters here: the user would then go and look for a provider that is not
    // in the config.
    vi.mocked(settingsApi.updateOpenCodeConfig).mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBe('Could not save the custom provider')
    expect(screen.getByTestId('custom-provider-dialog')).toBeInTheDocument()
    // The message is in the dialog too, not only in a toast behind a modal
    // that deliberately stayed open.
    expect(screen.getByTestId('dialog-error')).toHaveTextContent('boom')
  })

  it('leaves the confirmation open when the removal fails', async () => {
    vi.mocked(settingsApi.updateOpenCodeConfig).mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(screen.getByRole('button', { name: 'Remove Mine' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
    expect(vi.mocked(showErrorToast).mock.calls[0]?.[1]).toBe('Could not remove the custom provider')
  })
})
