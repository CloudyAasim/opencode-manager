import { useState, useMemo, useCallback } from 'react'
import { PanelLoading } from '@/components/ui/panel-loading'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Check, X, Shield, ChevronDown, ChevronRight, Key, Search, Pencil, Trash2, Plus } from 'lucide-react'
import { providerCredentialsApi, getProviders } from '@/api/providers'
import type { Provider } from '@/api/providers'
import { oauthApi, type OAuthAuthorizeResponse } from '@/api/oauth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { OAuthAuthorizeDialog } from './OAuthAuthorizeDialog'
import { OAuthCallbackDialog } from './OAuthCallbackDialog'
import { ApiKeyDialog } from '@/features/settings/ApiKeyDialog'
import { CustomProviderDialog } from './CustomProviderDialog'
import {
  customProviderDraftFromConfig,
  customProviderDraftFromEntry,
  buildCustomProviderEntry,
  withCustomProvider,
  withoutCustomProvider,
  type CustomProviderDraft,
} from './custom-provider'
import { ProviderConflictNotice } from './ProviderConflictNotice'
import { useKeepMineOnConflict, PROVIDER_DECLARATIONS_QUERY_KEY } from './useKeepMineOnConflict'
import { providerDeclarationsApi } from '@/api/providerDeclarations'
import { settingsApi } from '@/api/settings'
import { useOpenCodeConfigFile, OPEN_CODE_CONFIG_QUERY_KEY } from '@/hooks/useOpenCodeConfigFile'
import { useOptionalAuth } from '@/hooks/useAuth'
import { invalidateConfigCaches, invalidateProviderCaches } from '@/lib/queryInvalidation'
import { showErrorToast } from '@/lib/error-toast'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import type { OpenCodeConfigFile } from '@/api/types/settings'

/**
 * Which copy a declaration lands in. An administrator has both: the one every
 * session on the server reads, and the one that sits next to their API key.
 * They are the same shape and share an editor, but they are different files
 * with different reach, so an id taken in one is not taken in the other.
 */
type ProviderScope = 'global' | 'own'

/**
 * Which provider the editor is open on, in which copy. Carries the id rather
 * than a boolean so a save knows whether it is creating - and has to refuse a
 * collision - or editing one that is already there, and which of the two
 * documents to refuse the collision in.
 */
type ProviderDialogState =
  | { mode: 'closed' }
  | { mode: 'create'; scope: ProviderScope }
  | { mode: 'edit'; scope: ProviderScope; providerId: string }

type ProviderSummary = {
  id: string
  name: string
  modelCount: number
}

type PendingRemoval = { scope: ProviderScope; id: string; name: string }

function toProviderSummaries(
  entries: Record<string, Record<string, unknown>> | undefined,
): ProviderSummary[] {
  return Object.entries(entries ?? {}).map(([id, entry]) => {
    const options = (entry.options ?? {}) as Record<string, unknown>
    void options
    return {
      id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : id,
      modelCount: Object.keys((entry.models ?? {}) as Record<string, unknown>).length,
    }
  })
}

/**
 * One copy of the declaring panel: a heading, a count, and the rows.
 *
 * Rendered twice for an administrator, once for everybody else. The two copies
 * are deliberately the same component rather than two blocks of markup - two
 * front doors onto one behaviour is how they stop agreeing with each other.
 */
function ProviderSection({
  scope,
  title,
  description,
  hint,
  providers,
  expanded,
  onToggle,
  onCreate,
  onEdit,
  onRemove,
  hasCredentials,
  isPending,
  emptyTitle,
  emptyHint,
}: {
  scope: ProviderScope
  title: string
  description: string
  hint: string
  providers: ProviderSummary[]
  expanded: boolean
  onToggle: () => void
  onCreate: () => void
  onEdit: (providerId: string) => void
  onRemove: (provider: ProviderSummary) => void
  hasCredentials: (providerId: string) => boolean
  isPending: boolean
  emptyTitle: string
  emptyHint: string
}) {
  const { t } = useI18n()

  return (
    <section className="space-y-3" data-providers-scope={scope}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCreate}
        >
          <Plus className="h-4 w-4 mr-1" />
          {t('settingsPanels.provider.customProvidersAdd')}
        </Button>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-accent/50 rounded-md transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">
            {t('settingsPanels.provider.customProvidersDeclared')}
          </span>
          <Badge variant="secondary" className="ml-auto">
            {providers.length}
          </Badge>
        </button>

        {expanded && (
          <div className="pl-6 space-y-3">
            {providers.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="pt-6">
                  <p className="text-sm font-medium text-foreground text-center">{emptyTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground text-center">{emptyHint}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="divide-y divide-border">
                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{provider.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{provider.id}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {t('settingsPanels.provider.customProvidersModels', {
                            count: provider.modelCount,
                          })}
                        </span>
                        {hasCredentials(provider.id) ? (
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700 shrink-0">
                            <Check className="h-3 w-3 mr-1" />
                            {t('settingsPanels.provider.connected')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">
                            {t('settingsPanels.provider.customProvidersNoKey')}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(provider.id)}
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        {t('settingsPanels.provider.customProvidersEdit', { name: provider.name })}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => onRemove(provider)}
                        disabled={isPending}
                      >
                        {t('settingsPanels.provider.customProvidersDelete', { name: provider.name })}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export function ProviderSettings() {
  const { t } = useI18n()
  const auth = useOptionalAuth()

  // An administrator is a tenant too. They get the shared copy *and* one of
  // their own, side by side, because "the one everybody reads" and "the one
  // next to my API key" are two different promises and collapsing them means
  // an administrator can never try an endpoint before rolling it out.
  const isAdmin = auth?.user?.role === 'admin'

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthCallbackDialogOpen, setOauthCallbackDialogOpen] = useState(false)
  const [oauthResponse, setOauthResponse] = useState<OAuthAuthorizeResponse | null>(null)
  const [oauthMethodIndex, setOauthMethodIndex] = useState<number | null>(null)
  const [connectedExpanded, setConnectedExpanded] = useState(false)
  const [availableExpanded, setAvailableExpanded] = useState(true)
  const [availableSearch, setAvailableSearch] = useState('')
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [apiKeyProvider, setApiKeyProvider] = useState<Provider | null>(null)
  const [apiKeyMode, setApiKeyMode] = useState<'add' | 'edit'>('add')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [customProviderError, setCustomProviderError] = useState<string | null>(null)
  const [providerDialog, setProviderDialog] = useState<ProviderDialogState>({ mode: 'closed' })
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)
  // Each copy folds on its own, for the same reason they save on their own.
  const [globalExpanded, setGlobalExpanded] = useState(true)
  const [ownExpanded, setOwnExpanded] = useState(true)
  const queryClient = useQueryClient()

  const { data: providersData, isLoading: providersLoading } = useQuery({
    queryKey: ['providers'],
    queryFn: () => getProviders(),
    staleTime: 300000,
  })

  const providers = providersData?.providers

  const { data: credentialsList, isLoading: credentialsLoading } = useQuery({
    queryKey: ['provider-credentials'],
    queryFn: () => providerCredentialsApi.list(),
  })

  const { data: authMethods } = useQuery({
    queryKey: ['provider-auth-methods'],
    queryFn: () => oauthApi.getAuthMethods(),
  })

  const deleteCredentialMutation = useMutation({
    mutationFn: (providerId: string) => providerCredentialsApi.delete(providerId),
    onSuccess: () => {
      invalidateProviderCaches(queryClient)
    },
  })

  // Declaring a provider is a config edit, not a registration: Manager has no
  // provider catalogue, and the list this page renders is whatever OpenCode
  // reports.
  //
  // Two destinations, chosen by the section rather than by the role. The shared
  // one is only reachable by an administrator and only rendered for one; the
  // personal one is the same set of files their API key already lives in, so
  // "mine" means the one place a key and a definition cannot get out of step.
  const { data: openCodeConfig } = useOpenCodeConfigFile(isAdmin)
  const { data: ownDeclarations } = useQuery({
    queryKey: PROVIDER_DECLARATIONS_QUERY_KEY,
    queryFn: () => providerDeclarationsApi.list(),
  })

  const globalProviders = useMemo(
    () =>
      toProviderSummaries(
        (openCodeConfig?.content.provider ?? {}) as Record<string, Record<string, unknown>>,
      ),
    [openCodeConfig],
  )
  const ownProviders = useMemo(
    () => toProviderSummaries(ownDeclarations?.declarations),
    [ownDeclarations],
  )

  const editingScope: ProviderScope | null =
    providerDialog.mode === 'closed' ? null : providerDialog.scope
  const editingProviderId =
    providerDialog.mode === 'edit' ? providerDialog.providerId : null
  // An id taken in one copy is not taken in the other. Declaring the same
  // provider globally and again for yourself is how you try an endpoint before
  // rolling it out, so the editor only refuses a collision inside its own copy.
  const existingProviderIds = useMemo(
    () => (editingScope === 'global' ? globalProviders : ownProviders).map((p) => p.id),
    [editingScope, globalProviders, ownProviders],
  )

  /**
   * The declaration the editor opens on, memoised.
   *
   * Not for tidiness. `CustomProviderDialog` resets its form from this in an
   * effect keyed on it, so building it inline handed the effect a fresh object
   * on every render - and a reset on every render re-renders, which rebuilds it
   * again. Editing a provider would have fought itself.
   */
  const editingDraft = useMemo(() => {
    if (!editingProviderId || !editingScope) return undefined
    if (editingScope === 'global') {
      return openCodeConfig
        ? customProviderDraftFromConfig(editingProviderId, openCodeConfig.content)
        : undefined
    }
    const entry = ownDeclarations?.declarations?.[editingProviderId]
    return entry ? customProviderDraftFromEntry(editingProviderId, entry) : undefined
  }, [editingProviderId, editingScope, openCodeConfig, ownDeclarations])

  const { keepMine: keepMineOnConflict, isPending: conflictPending } = useKeepMineOnConflict()

  const saveCustomProviderMutation = useMutation({
    mutationFn: async ({ draft, scope }: { draft: CustomProviderDraft; scope: ProviderScope }) => {
      if (scope === 'own') {
        // The entry the dialog built, not the whole document. The per-user
        // endpoint takes one provider and nothing else, so there is no request
        // shape here that could carry a model, a permission or an MCP server.
        return providerDeclarationsApi.declare(
          draft.providerId,
          buildCustomProviderEntry(draft) as unknown as Record<string, unknown>,
        )
      }
      const current = queryClient.getQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY)
      if (!current) {
        throw new Error('opencode-config-not-loaded')
      }
      return settingsApi.updateOpenCodeConfig({
        content: withCustomProvider(current.content, draft),
        expectedRevision: current.revision,
      })
    },
    onSuccess: (_result, variables) => {
      // The provider list is cached from OpenCode's own last answer, and the
      // document that was just changed has to be re-read; otherwise the change
      // does not show up until the page is reloaded.
      invalidateConfigCaches(queryClient)
      invalidateProviderCaches(queryClient)
      if (variables.scope === 'own') {
        void queryClient.invalidateQueries({ queryKey: PROVIDER_DECLARATIONS_QUERY_KEY })
      }
      setProviderDialog({ mode: 'closed' })
      setCustomProviderError(null)
      showToast.success(t('settingsPanels.provider.customProvidersSaved'))
    },
    onError: (error) => {
      // Twice, on purpose: the toast is the same channel the delete path uses,
      // and the dialog deliberately stays open - where a toast behind a modal
      // is easy to miss. A conflict (409) carries the server's own wording,
      // which says what changed and is worth showing verbatim.
      const message = error instanceof Error && error.message ? error.message : t('settingsPanels.provider.customProvidersSaveFailed')
      setCustomProviderError(message)
      showErrorToast(error, t('settingsPanels.provider.customProvidersSaveFailed'))
    },
  })

  const removeCustomProviderMutation = useMutation({
    mutationFn: async ({ providerId, scope }: { providerId: string; scope: ProviderScope }) => {
      if (scope === 'own') {
        return providerDeclarationsApi.remove(providerId)
      }
      const current = queryClient.getQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY)
      if (!current) {
        throw new Error('opencode-config-not-loaded')
      }
      return settingsApi.updateOpenCodeConfig({
        content: withoutCustomProvider(current.content, providerId),
        expectedRevision: current.revision,
      })
    },
    onSuccess: () => {
      invalidateConfigCaches(queryClient)
      invalidateProviderCaches(queryClient)
      void queryClient.invalidateQueries({ queryKey: PROVIDER_DECLARATIONS_QUERY_KEY })
      setPendingRemoval(null)
      showToast.success(t('settingsPanels.provider.customProvidersRemoved'))
    },
    // The confirmation stays open on failure: closing it would make a refused
    // delete look like a completed one.
    onError: (error) => showErrorToast(error, t('settingsPanels.provider.customProvidersRemoveFailed')),
  })

  const handleDeleteCredential = (providerId: string) => {
    setDeleteTarget(providerId)
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    // The dialog carries a spinner, so let it stay open until the delete
    // actually lands - closing it up front meant a failure looked identical
    // to a success.
    deleteCredentialMutation.mutate(deleteTarget, {
      onSuccess: () => setDeleteTarget(null),
      onError: (error) => showErrorToast(error, t('settingsPanels.provider.removeCredentialsFailed')),
    })
  }

  const handleDeleteCancel = () => {
    setDeleteTarget(null)
  }

  const handleOAuthAuthorize = (response: OAuthAuthorizeResponse, methodIndex: number) => {
    setOauthResponse(response)
    setOauthMethodIndex(methodIndex)
    setOauthDialogOpen(false)
    setOauthCallbackDialogOpen(true)
  }

  const handleOAuthDialogClose = () => {
    setOauthDialogOpen(false)
    setOauthMethodIndex(null)
    setSelectedProvider(null)
  }

  const handleOAuthSuccess = () => {
    invalidateProviderCaches(queryClient)
    setOauthCallbackDialogOpen(false)
    setOauthResponse(null)
    setOauthMethodIndex(null)
    setSelectedProvider(null)
  }

  const supportsOAuth = useCallback((providerId: string) => {
    const methods = authMethods?.[providerId] || []
    return methods.some(method => method.type === 'oauth')
  }, [authMethods])

  const hasCredentials = useCallback((providerId: string) => {
    return credentialsList?.includes(providerId) || false
  }, [credentialsList])

  const oauthProviders = useMemo(() => {
    if (!providers || !authMethods) return []
    const oauth = providers.filter(provider => supportsOAuth(provider.id))
    return oauth.slice().sort((a, b) => {
      const aConnected = hasCredentials(a.id) ? 1 : 0
      const bConnected = hasCredentials(b.id) ? 1 : 0
      return bConnected - aConnected
    })
  }, [providers, authMethods, supportsOAuth, hasCredentials])

  const apiKeyProviders = useMemo(() => {
    if (!providers || !authMethods) return { connected: [], available: [] }
    const nonOAuthProviders = providers.filter(provider => !supportsOAuth(provider.id))
    const connected = nonOAuthProviders.filter(provider => hasCredentials(provider.id))
    const available = nonOAuthProviders.filter(provider => !hasCredentials(provider.id))
    return { connected, available }
  }, [providers, authMethods, supportsOAuth, hasCredentials])

  const filteredAvailableProviders = useMemo(() => {
    if (!availableSearch.trim()) return apiKeyProviders.available
    const search = availableSearch.toLowerCase()
    return apiKeyProviders.available.filter(provider =>
      provider.name.toLowerCase().includes(search) ||
      provider.id.toLowerCase().includes(search)
    )
  }, [apiKeyProviders.available, availableSearch])

  const selectedProviderName = useMemo(() => {
    if (!selectedProvider) return ''
    return providers?.find(p => p.id === selectedProvider)?.name || selectedProvider
  }, [selectedProvider, providers])

  const handleAddApiKey = useCallback((provider: Provider) => {
    setApiKeyProvider(provider)
    setApiKeyMode('add')
    setApiKeyDialogOpen(true)
  }, [])

  const handleEditApiKey = useCallback((provider: Provider) => {
    setApiKeyProvider(provider)
    setApiKeyMode('edit')
    setApiKeyDialogOpen(true)
  }, [])

  const handleApiKeySuccess = useCallback(() => {
    setApiKeyDialogOpen(false)
    setApiKeyProvider(null)
    invalidateProviderCaches(queryClient)
  }, [queryClient])

  const handleApiKeyDialogClose = useCallback((open: boolean) => {
    setApiKeyDialogOpen(open)
    if (!open) {
      setApiKeyProvider(null)
    }
  }, [])

  const openCreate = useCallback((scope: ProviderScope) => {
    setCustomProviderError(null)
    setProviderDialog({ mode: 'create', scope })
  }, [])

  const openEdit = useCallback((scope: ProviderScope, providerId: string) => {
    setCustomProviderError(null)
    setProviderDialog({ mode: 'edit', scope, providerId })
  }, [])

  if (providersLoading || credentialsLoading) {
    return (
      <PanelLoading />
    )
  }

  const conflictVariant = isAdmin ? 'administrator' : 'tenant'

  return (
    <div className="@container w-full max-w-7xl space-y-8">
      <div className="grid gap-8 @min-[1000px]:grid-cols-2 @min-[1000px]:items-start">
        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">{t('settingsPanels.provider.oauthProviders')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('settingsPanels.provider.oauthProvidersDescription')}
            </p>
          </div>

        {oauthProviders.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground text-center">
                {t('settingsPanels.provider.noOauthProviders')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="divide-y divide-border">
            {oauthProviders.map((provider) => {
              const hasKey = hasCredentials(provider.id)
              const modelCount = Object.keys(provider.models || {}).length

              return (
                <div key={provider.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {provider.name || provider.id}
                    </p>
                    {modelCount > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('settingsPanels.provider.models', { count: modelCount })}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasKey ? (
                      <Badge variant="default" className="bg-green-600 hover:bg-green-700 shrink-0">
                        <Check className="h-3 w-3 mr-1" />
                        {t('settingsPanels.provider.connected')}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        <X className="h-3 w-3 mr-1" />
                        {t('settingsPanels.provider.notConnected')}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={hasKey ? 'outline' : 'default'}
                      onClick={() => {
                        setSelectedProvider(provider.id)
                        setOauthDialogOpen(true)
                      }}
                    >
                      <Shield className="h-4 w-4 mr-1" />
                      {hasKey ? t('settingsPanels.provider.reconnect') : t('settingsPanels.provider.connect')}
                    </Button>
                    {hasKey && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteCredential(provider.id)}
                        disabled={deleteCredentialMutation.isPending}
                      >
                        {t('settingsPanels.provider.disconnect')}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {selectedProvider && (
          <OAuthAuthorizeDialog
            providerId={selectedProvider}
            providerName={selectedProviderName}
            methods={authMethods?.[selectedProvider] || []}
            open={oauthDialogOpen}
            onOpenChange={handleOAuthDialogClose}
            onSuccess={handleOAuthAuthorize}
          />
        )}

        {selectedProvider && oauthResponse && oauthMethodIndex !== null && (
          <OAuthCallbackDialog
            providerId={selectedProvider}
            providerName={selectedProviderName}
            authResponse={oauthResponse}
            methodIndex={oauthMethodIndex}
            open={oauthCallbackDialogOpen}
            onOpenChange={setOauthCallbackDialogOpen}
            onSuccess={handleOAuthSuccess}
          />
        )}
        </div>

        <div className="min-w-0 space-y-6">
          {/* Admin-only, and not hidden by CSS. The raw editor writes the one
              config every session on the server reads, so showing it to a
              non-admin and refusing the save would be a button that always
              fails. */}
          {isAdmin && (
            <ProviderSection
              scope="global"
              title={t('settingsPanels.provider.customProvidersGlobal')}
              description={t('settingsPanels.provider.customProvidersGlobalDescription')}
              hint={t('settingsPanels.provider.customProvidersScopeGlobal')}
              providers={globalProviders}
              expanded={globalExpanded}
              onToggle={() => setGlobalExpanded((open) => !open)}
              onCreate={() => openCreate('global')}
              onEdit={(providerId) => openEdit('global', providerId)}
              onRemove={(provider) => setPendingRemoval({ scope: 'global', id: provider.id, name: provider.name })}
              hasCredentials={hasCredentials}
              isPending={removeCustomProviderMutation.isPending}
              emptyTitle={t('settingsPanels.provider.customProvidersEmptyTitle')}
              emptyHint={t('settingsPanels.provider.customProvidersEmptyHint')}
            />
          )}

          {/* The notice is deliberately outside the disclosure. A collision is
              the one thing here waiting on a decision, and folding it behind
              the same toggle as the list is how it stays undecided. */}
          <ProviderConflictNotice
            variant={conflictVariant}
            conflicts={(ownDeclarations?.conflicts ?? []).filter((c) => !c.acknowledged)}
            onKeepMine={(id) => {
              void keepMineOnConflict(id)
            }}
            onUseGlobal={(id) => {
              // Straight to the mutation, not through the row's own
              // confirmation: the notice already asked, and asking twice
              // for one irreversible action is how people click the first
              // one without reading the second.
              setCustomProviderError(null)
              removeCustomProviderMutation.mutate({ providerId: id, scope: 'own' })
            }}
            isPending={conflictPending || removeCustomProviderMutation.isPending}
          />

          <ProviderSection
            scope="own"
            title={t('settingsPanels.provider.customProvidersOwn')}
            description={t('settingsPanels.provider.customProvidersOwnDescription')}
            hint={t('settingsPanels.provider.customProvidersScopeOwn')}
            providers={ownProviders}
            expanded={ownExpanded}
            onToggle={() => setOwnExpanded((open) => !open)}
            onCreate={() => openCreate('own')}
            onEdit={(providerId) => openEdit('own', providerId)}
            onRemove={(provider) => setPendingRemoval({ scope: 'own', id: provider.id, name: provider.name })}
            hasCredentials={hasCredentials}
            isPending={removeCustomProviderMutation.isPending}
            emptyTitle={t('settingsPanels.provider.customProvidersEmptyTitle')}
            emptyHint={t('settingsPanels.provider.customProvidersEmptyHint')}
          />

          <div className="border-t border-border pt-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">{t('settingsPanels.provider.apiKeys')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('settingsPanels.provider.apiKeysDescription')}
            </p>
          </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setConnectedExpanded(!connectedExpanded)}
            aria-expanded={connectedExpanded}
            className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-accent/50 rounded-md transition-colors"
          >
            {connectedExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">{t('settingsPanels.provider.connected')}</span>
            <Badge variant="secondary" className="ml-auto">
              {apiKeyProviders.connected.length}
            </Badge>
          </button>

          {connectedExpanded && (
            <div className="pl-6 space-y-2">
              {apiKeyProviders.connected.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t('settingsPanels.provider.noProvidersConfigured')}
                </p>
              ) : (
                apiKeyProviders.connected.map((provider) => {
                  const modelCount = Object.keys(provider.models || {}).length
                  return (
                    <Card key={provider.id} className="bg-card border-border">
                      <CardHeader className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-sm truncate">
                              {provider.name || provider.id}
                            </CardTitle>
                            {modelCount > 0 && (
                              <CardDescription className="text-xs">
                                {t('settingsPanels.provider.models', { count: modelCount })}
                              </CardDescription>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="default" className="bg-green-600 hover:bg-green-700 shrink-0 text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              {t('settingsPanels.provider.connected')}
                            </Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditApiKey(provider)}
                              aria-label={t('settingsPanels.provider.editApiKeyFor', { name: provider.name || provider.id })}
                              className="h-8 w-8 p-0"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteCredential(provider.id)}
                              disabled={deleteCredentialMutation.isPending}
                              aria-label={t('settingsPanels.provider.removeCredentialsFor', { name: provider.name || provider.id })}
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  )
                })
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setAvailableExpanded(!availableExpanded)}
            aria-expanded={availableExpanded}
            className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-accent/50 rounded-md transition-colors"
          >
            {availableExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">{t('settingsPanels.provider.availableProviders')}</span>
            <Badge variant="secondary" className="ml-auto">
              {apiKeyProviders.available.length}
            </Badge>
          </button>

          {availableExpanded && (
            <div className="pl-6 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('settingsPanels.provider.searchPlaceholder')}
                  value={availableSearch}
                  onChange={(e) => setAvailableSearch(e.target.value)}
                  className="pl-9 md:text-sm"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin pt-4 pb-1 pr-1 [mask-image:linear-gradient(to_bottom,transparent,black_16px,black)]">
                {filteredAvailableProviders.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    {availableSearch ? t('settingsPanels.provider.noProvidersMatch') : t('settingsPanels.provider.noAvailableProviders')}
                  </p>
                ) : (
                  filteredAvailableProviders.map((provider, index) => {
                    const modelCount = Object.keys(provider.models || {}).length
                    return (
                      <div key={provider.id} className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-accent/80 transition-colors ${index % 2 === 1 ? 'bg-accent/30' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate block">
                            {provider.name || provider.id}
                          </span>
                          {modelCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {t('settingsPanels.provider.models', { count: modelCount })}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleAddApiKey(provider)}
                          className="h-7 px-2"
                        >
                          <Key className="h-3.5 w-3.5 mr-1" />
                          {t('settingsPanels.provider.addKey')}
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
          </div>
        </div>
      </div>

      {apiKeyProvider && (
        <ApiKeyDialog
          open={apiKeyDialogOpen}
          onOpenChange={handleApiKeyDialogClose}
          provider={{
            id: apiKeyProvider.id,
            name: apiKeyProvider.name,
            api: apiKeyProvider.api,
            env: apiKeyProvider.env || [],
            npm: apiKeyProvider.npm,
            models: Object.entries(apiKeyProvider.models || {}).map(([id, model]) => ({
              id,
              name: model.name || id,
            })),
            source: 'builtin',
            isConnected: hasCredentials(apiKeyProvider.id),
          }}
          onSuccess={handleApiKeySuccess}
          mode={apiKeyMode}
        />
      )}

      <CustomProviderDialog
        open={providerDialog.mode !== 'closed'}
        onOpenChange={(open) => {
          if (!open) {
            setProviderDialog({ mode: 'closed' })
            setCustomProviderError(null)
          }
        }}
        existingProviderIds={existingProviderIds}
        editingProviderId={editingProviderId ?? undefined}
        initialDraft={editingDraft}
        isSubmitting={saveCustomProviderMutation.isPending}
        error={customProviderError}
        onSubmit={(draft) => {
          // `mutate` is fire-and-forget by design; the dialog closes in the
          // mutation's own `onSuccess` so a failure leaves it open with the
          // fields still in it.
          if (providerDialog.mode === 'closed') return
          saveCustomProviderMutation.mutate({ draft, scope: providerDialog.scope })
        }}
      />

      <DeleteDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        onConfirm={() => {
          if (!pendingRemoval) return
          removeCustomProviderMutation.mutate({
            providerId: pendingRemoval.id,
            scope: pendingRemoval.scope,
          })
        }}
        onCancel={() => setPendingRemoval(null)}
        title={t('settingsPanels.provider.customProvidersDeleteTitle')}
        description={t('settingsPanels.provider.customProvidersDeleteDescription', {
          name: pendingRemoval?.name ?? '',
        })}
        isDeleting={removeCustomProviderMutation.isPending}
      />

      <DeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        title={t('settingsPanels.provider.removeCredentialsTitle')}
        description={t('settingsPanels.provider.removeCredentialsDescription', { name: deleteTarget || t('settingsPanels.provider.thisProvider') })}
        isDeleting={deleteCredentialMutation.isPending}
      />
    </div>
  )
}