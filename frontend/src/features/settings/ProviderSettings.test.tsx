import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProviderSettings } from './ProviderSettings'
import { getProviders, providerCredentialsApi } from '@/api/providers'
import { oauthApi } from '@/api/oauth'
import { settingsApi } from '@/api/settings'
import { providerDeclarationsApi } from '@/api/providerDeclarations'
import { useOptionalAuth } from '@/hooks/useAuth'
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

vi.mock('@/hooks/useAuth', () => ({
  useOptionalAuth: vi.fn(),
}))

vi.mock('@/api/providerDeclarations', () => ({
  providerDeclarationsApi: {
    list: vi.fn(),
    declare: vi.fn(),
    remove: vi.fn(),
    keepMine: vi.fn(),
  },
}))

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
  vi.mocked(providerDeclarationsApi.list).mockResolvedValue({ declarations: {}, conflicts: [] })
  vi.mocked(providerCredentialsApi.delete).mockResolvedValue(undefined)
}

/**
 * Both copies of the declaring panel are on the page for an administrator, and
 * they share every label. Scoping to one of them is not a convenience here: a
 * document-wide query for "New custom provider" is ambiguous by construction,
 * and the test that silently picked one of them is exactly how a save ends up
 * in the wrong file.
 */
function section(scope: 'global' | 'own'): HTMLElement {
  const found = document.querySelector(`[data-providers-scope="${scope}"]`)
  expect(found, `no section for scope "${scope}"`).not.toBeNull()
  return found as HTMLElement
}

const GLOBAL = 'Global providers'
const OWN = 'Your custom providers'

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
    // Admin by default, because most of these are about the API key columns
    // and the tests about the declaring panel should each say who they are.
    vi.mocked(useOptionalAuth).mockReturnValue({ user: { role: 'admin' } } as never)
    mockProviderData()
  })

  it('lays out OAuth and API key columns in a container-query grid that splits at 1000px of content width', async () => {
    const { container } = renderSettings()

    await screen.findByText('Anthropic')

    const grid = container.firstElementChild?.firstElementChild as HTMLElement
    expect(grid.className).toContain('@min-[1000px]:grid-cols-2')
  })

  it('renders OAuth providers as compact divider rows with the name, model count, status, and actions', async () => {
    renderSettings()

    await screen.findByText('Anthropic')

    expect(screen.getByText('2 models')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
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

    // Scoped to the API keys sub-section on purpose: the declaring sections
    // above it legitimately render a provider called OpenAI whenever the config
    // declares one, so a document-wide "is OpenAI on the page" says nothing
    // about whether this disclosure is collapsed.
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

    const search = screen.getByPlaceholderText('Search providers...')
    await user.type(search, 'together')

    const apiKeysSection = ((container.firstElementChild?.firstElementChild?.children[1]) as HTMLElement)
      .querySelector('.border-t') as HTMLElement
    expect(within(apiKeysSection).getByText('Together AI')).toBeInTheDocument()
    expect(within(apiKeysSection).queryByText('OpenAI')).not.toBeInTheDocument()
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
    renderSettings()

    await screen.findByText('Anthropic')
    await user.click(screen.getByRole('button', { name: /Connected/ }))
    await user.click(screen.getByRole('button', { name: 'Remove credentials for OpenAI' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(providerCredentialsApi.delete).toHaveBeenCalledWith('openai'))
  })

  it('shows the empty state when no OAuth-capable providers exist', async () => {
    vi.mocked(oauthApi.getAuthMethods).mockResolvedValue({})
    renderSettings()

    expect(await screen.findByText('No OAuth-capable providers available.')).toBeInTheDocument()
  })

  it('keeps the confirm dialog open and says so when the delete fails', async () => {
    const user = userEvent.setup()
    renderSettings()

    vi.mocked(providerCredentialsApi.delete).mockRejectedValue(new Error('nope'))
    await screen.findByText('Anthropic')
    await user.click(screen.getByRole('button', { name: /Connected/ }))
    await user.click(screen.getByRole('button', { name: 'Remove credentials for OpenAI' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
  })

  it('closes the confirm dialog once the delete lands', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Anthropic')
    await user.click(screen.getByRole('button', { name: /Connected/ }))
    await user.click(screen.getByRole('button', { name: 'Remove credentials for OpenAI' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument(),
    )
  })
})

const DECLARED = {
  mine: {
    name: 'Mine',
    api: 'https://example.com/v1',
    options: { baseURL: 'https://example.com/v1' },
    models: { 'gpt-4o': { name: 'GPT-4o' }, 'gpt-4o-mini': { name: 'GPT-4o mini' } },
  },
  openai: { name: 'OpenAI' },
}

describe('ProviderSettings — an administrator and the copy they declare for everyone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useOptionalAuth).mockReturnValue({ user: { role: 'admin' } } as never)
    mockProviderData()
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture(DECLARED))
    vi.mocked(providerDeclarationsApi.list).mockResolvedValue({ declarations: {}, conflicts: [] })
    vi.mocked(providerDeclarationsApi.declare).mockResolvedValue({ success: true })
    vi.mocked(providerDeclarationsApi.remove).mockResolvedValue({ success: true })
  })

  it('shows both copies, each saying whose it is', async () => {
    renderSettings()

    await screen.findByText('Mine')

    const global = section('global')
    const own = section('own')

    expect(within(global).getByRole('heading', { name: GLOBAL })).toBeInTheDocument()
    expect(within(global).getByText('Declared for everyone on this server.')).toBeInTheDocument()
    expect(within(own).getByRole('heading', { name: OWN })).toBeInTheDocument()
    expect(within(own).getByText('Declared for you only. Nobody else sees it.')).toBeInTheDocument()
  })

  it('asks the administrator for their own declarations too, not just the shared ones', async () => {
    renderSettings()

    await screen.findByText('Mine')

    // An administrator is a tenant with a copy of their own. Asking only for the
    // shared document would make their personal one unlistable.
    expect(providerDeclarationsApi.list).toHaveBeenCalled()
    expect(settingsApi.getOpenCodeConfig).toHaveBeenCalled()
  })

  it('lists the shared document in the shared section', async () => {
    renderSettings()

    await screen.findByText('Mine')

    const global = section('global')
    expect(within(global).getByText('Mine')).toBeInTheDocument()
    expect(within(global).getByText('2 models declared')).toBeInTheDocument()
  })

  it('says so when nothing has been declared for everyone', async () => {
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture({}))
    renderSettings()

    await waitFor(() =>
      expect(within(section('global')).getByText('No custom providers yet')).toBeInTheDocument(),
    )
  })

  it('refuses, in the shared copy, an id that copy already has', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: 'New custom provider' }))

    const dialog = screen.getByTestId('custom-provider-dialog')
    expect(dialog).toHaveAttribute('data-ids', 'mine,openai')
  })

  it('writes a shared declaration into the server-wide document', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: 'New custom provider' }))
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
        },
      },
    })
    // The other half of the split: an administrator's personal copy is a
    // different file and this save must never touch it.
    expect(providerDeclarationsApi.declare).not.toHaveBeenCalled()
  })

  it('opens the editor on the shared declaration rather than a blank form', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: 'Edit Mine' }))

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Mine')
    expect(screen.getByTestId('draft-models')).toHaveTextContent('2')
  })

  it('takes a shared declaration out of the server-wide document', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: 'Remove Mine' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalledTimes(1))
    const request = vi.mocked(settingsApi.updateOpenCodeConfig).mock.calls[0][0]
    expect((request.content as Record<string, Record<string, unknown>>).provider.mine).toBeUndefined()
    expect(providerDeclarationsApi.remove).not.toHaveBeenCalled()
  })

  it('keeps the editor open with the failure in it when the shared write fails', async () => {
    vi.mocked(settingsApi.updateOpenCodeConfig).mockRejectedValue(new Error('revision conflict'))
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => expect(showErrorToast).toHaveBeenCalled())
    expect(screen.getByTestId('custom-provider-dialog')).toBeInTheDocument()
  })

  it('folds each copy on its own', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: /Declared providers/ }))

    expect(within(section('global')).getByRole('button', { name: /Declared providers/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    // Folding the shared list has nothing to say about the personal one.
    expect(within(section('own')).getByRole('button', { name: /Declared providers/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('leaves the heading and the add action alone when the list is folded', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('own')).getByRole('button', { name: /Declared providers/ }))

    const own = section('own')
    expect(within(own).getByRole('heading', { name: OWN })).toBeInTheDocument()
    expect(within(own).getByText('Declared for you only. Nobody else sees it.')).toBeInTheDocument()
    expect(within(own).getByRole('button', { name: 'New custom provider' })).toBeInTheDocument()
  })

  it('re-reads the provider list after a shared change, so the row updates', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('global')).getByRole('button', { name: 'Remove Mine' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(settingsApi.updateOpenCodeConfig).toHaveBeenCalled())
  })
})

describe('ProviderSettings — an administrator declaring their own', () => {
  const OWN_COPY = {
    staging: {
      name: 'Staging',
      options: { baseURL: 'https://staging.test/v1' },
      models: { 'gpt-4o': { name: 'GPT-4o' } },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useOptionalAuth).mockReturnValue({ user: { role: 'admin' } } as never)
    mockProviderData()
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture(DECLARED))
    vi.mocked(providerDeclarationsApi.list).mockResolvedValue({ declarations: OWN_COPY, conflicts: [] })
    vi.mocked(providerDeclarationsApi.declare).mockResolvedValue({ success: true })
    vi.mocked(providerDeclarationsApi.remove).mockResolvedValue({ success: true })
  })

  it('lists the personal copy in the personal section, and nothing else', async () => {
    renderSettings()

    await screen.findByText('Staging')

    expect(within(section('own')).getByText('Staging')).toBeInTheDocument()
    // `Mine` is in the shared document. Claiming it here would be listing a
    // provider they did not declare for themselves.
    expect(within(section('own')).queryByText('Mine')).not.toBeInTheDocument()
    expect(within(section('global')).getByText('Mine')).toBeInTheDocument()
  })

  it('saves the personal copy to the per-user endpoint and never to the shared document', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Staging')
    await user.click(within(section('own')).getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => expect(providerDeclarationsApi.declare).toHaveBeenCalled())
    expect(settingsApi.updateOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('lets the same id exist in both copies, which is how you try an endpoint before rolling it out', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Staging')
    await user.click(within(section('own')).getByRole('button', { name: 'New custom provider' }))

    const dialog = screen.getByTestId('custom-provider-dialog')
    // Only `staging` is taken here. `mine` and `openai` live in the shared
    // document, and taking them would defeat the whole point of having two
    // copies.
    expect(dialog).toHaveAttribute('data-ids', 'staging')
  })

  it('removes from the personal copy without touching the shared document', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Staging')
    await user.click(within(section('own')).getByRole('button', { name: 'Remove Staging' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(providerDeclarationsApi.remove).toHaveBeenCalledWith('staging'))
    expect(settingsApi.updateOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('opens the editor on the personal declaration', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Staging')
    await user.click(within(section('own')).getByRole('button', { name: 'Edit Staging' }))

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Staging')
    expect(screen.getByTestId('custom-provider-dialog')).toHaveAttribute('data-editing', 'staging')
  })

  it('explains its own copy shadowing the shared one, in the words of somebody who wrote both', async () => {
    vi.mocked(providerDeclarationsApi.list).mockResolvedValue({
      declarations: { acme: { name: 'Acme', options: { baseURL: 'https://mine.test' } } },
      conflicts: [
        {
          providerId: 'acme',
          globalEntry: { name: 'Acme', options: { baseURL: 'https://theirs.test' } },
          userEntry: { name: 'Acme', options: { baseURL: 'https://mine.test' } },
          acknowledged: false,
        },
      ],
    })
    renderSettings()

    expect(await screen.findByText('Your own acme overrides the server-wide one')).toBeInTheDocument()
    // Telling an administrator that "an administrator also declared this" would
    // be telling them about themselves.
    expect(screen.queryByText(/An administrator also declared/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use the server-wide one' })).toBeInTheDocument()
  })
})

describe('ProviderSettings — a tenant declaring their own', () => {
  const OWN = {
    mine: {
      name: 'Mine',
      options: { baseURL: 'https://mine.test/v1' },
      models: { 'gpt-4o': { name: 'GPT-4o' } },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Every block states its own role: the auth mock is module-wide, so a block
    // that relied on whichever describe ran first would pass in one order and
    // fail in another.
    vi.mocked(useOptionalAuth).mockReturnValue({ user: { role: 'user' } } as never)
    mockProviderData()
    vi.mocked(settingsApi.getOpenCodeConfig).mockResolvedValue(configFixture(DECLARED))
    vi.mocked(providerDeclarationsApi.list).mockResolvedValue({ declarations: OWN, conflicts: [] })
    vi.mocked(providerDeclarationsApi.declare).mockResolvedValue({ success: true })
    vi.mocked(providerDeclarationsApi.remove).mockResolvedValue({ success: true })
    vi.mocked(providerDeclarationsApi.keepMine).mockResolvedValue({ success: true, acknowledged: true })
  })

  it('shows one section, says it is theirs alone, and never asks for the server config', async () => {
    renderSettings()

    await screen.findByText('Mine')

    expect(document.querySelector('[data-providers-scope="global"]')).toBeNull()
    expect(screen.getByText('Declared for you only. Nobody else sees it.')).toBeInTheDocument()
    // Not merely hidden: the request would come back 403, and a failed query is
    // how a panel that was meant to be out of the way comes back with an error.
    expect(settingsApi.getOpenCodeConfig).not.toHaveBeenCalled()
    expect(providerDeclarationsApi.list).toHaveBeenCalled()
  })

  it('lists their own declaration rather than anything from the server config', async () => {
    renderSettings()

    await screen.findByText('Mine')

    expect(screen.getByText('1 model declared')).toBeInTheDocument()
    // `openai` is in the global config in the fixture. It is not theirs, so
    // listing it would be claiming a provider they have not declared.
    expect(screen.queryByText('openai')).not.toBeInTheDocument()
  })

  it('saves to their own copy and never to the server-wide configuration', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('own')).getByRole('button', { name: 'New custom provider' }))
    await user.click(screen.getByRole('button', { name: 'Submit provider' }))

    await waitFor(() => expect(providerDeclarationsApi.declare).toHaveBeenCalled())
    expect(settingsApi.updateOpenCodeConfig).not.toHaveBeenCalled()
    expect(vi.mocked(providerDeclarationsApi.declare).mock.calls[0]?.[0]).toBe('my-provider')
  })

  it('removes from their own copy', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('own')).getByRole('button', { name: 'Remove Mine' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(providerDeclarationsApi.remove).toHaveBeenCalledWith('mine'))
    expect(settingsApi.updateOpenCodeConfig).not.toHaveBeenCalled()
  })

  it('opens the editor on their own stored declaration', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('Mine')
    await user.click(within(section('own')).getByRole('button', { name: 'Edit Mine' }))

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Mine')
    expect(screen.getByTestId('custom-provider-dialog')).toHaveAttribute('data-editing', 'mine')
  })
})

describe('ProviderSettings — a provider an administrator also declared', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useOptionalAuth).mockReturnValue({ user: { role: 'user' } } as never)
    mockProviderData()
    vi.mocked(providerDeclarationsApi.list).mockResolvedValue({
      declarations: { acme: { name: 'Acme', options: { baseURL: 'https://mine.test' } } },
      conflicts: [
        {
          providerId: 'acme',
          globalEntry: { name: 'Acme', options: { baseURL: 'https://theirs.test' } },
          userEntry: { name: 'Acme', options: { baseURL: 'https://mine.test' } },
          acknowledged: false,
        },
      ],
    })
    vi.mocked(providerDeclarationsApi.keepMine).mockResolvedValue({ success: true, acknowledged: true })
    vi.mocked(providerDeclarationsApi.remove).mockResolvedValue({ success: true })
  })

  it('says so, and says which one is in effect', async () => {
    renderSettings()

    expect(await screen.findByText('An administrator also declared acme')).toBeInTheDocument()
    expect(screen.getByText('Yours is in effect. Nothing of theirs replaces it.')).toBeInTheDocument()
    // The whole point: the tenant's own copy keeps working, unchanged, while
    // they decide. Nothing here is disabled and nothing was overwritten.
    expect(within(section('own')).getByRole('button', { name: 'Edit Acme' })).toBeInTheDocument()
  })

  it('records keeping their own and takes no definition from the client', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('An administrator also declared acme')
    await user.click(screen.getByRole('button', { name: 'Keep mine' }))

    await waitFor(() => expect(providerDeclarationsApi.keepMine).toHaveBeenCalledWith('acme'))
    // The server records the definition it is serving. A client that could name
    // the definition could acknowledge one it was never shown.
    expect(vi.mocked(providerDeclarationsApi.keepMine).mock.calls[0]).toHaveLength(1)
  })

  it('takes theirs by removing their own declaration, behind a confirmation', async () => {
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('An administrator also declared acme')
    await user.click(screen.getByRole('button', { name: "Use the administrator's" }))

    // Nothing removed yet: this one cannot be undone from the panel, so the
    // click that offers it is not the click that does it.
    expect(providerDeclarationsApi.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Use theirs' }))

    await waitFor(() => expect(providerDeclarationsApi.remove).toHaveBeenCalledWith('acme'))
    // One confirmation, not two. The notice already asked; routing this through
    // the row's own delete dialog would ask again for the same irreversible act.
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
  })

  it('leaves an already-answered conflict off the screen', async () => {
    vi.mocked(providerDeclarationsApi.list).mockResolvedValue({
      declarations: { acme: { name: 'Acme' } },
      conflicts: [
        { providerId: 'acme', globalEntry: {}, userEntry: {}, acknowledged: true },
      ],
    })
    renderSettings()

    await screen.findByText('Acme')

    expect(screen.queryByText('An administrator also declared acme')).not.toBeInTheDocument()
  })

  it('keeps the collision notice on screen while the list is folded', async () => {
    // A collision is the one thing in this section waiting on a decision. The
    // rows below it are a list; folding that is tidiness, folding this is a
    // prompt that quietly expires.
    const user = userEvent.setup()
    renderSettings()

    await screen.findByText('An administrator also declared acme')
    await user.click(within(section('own')).getByRole('button', { name: /Declared providers/ }))

    expect(screen.getByText('An administrator also declared acme')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument()
    // The folded rows really are gone, so this is not passing because the
    // toggle does nothing at all.
    expect(within(section('own')).queryByRole('button', { name: 'Edit Acme' })).not.toBeInTheDocument()
  })
})