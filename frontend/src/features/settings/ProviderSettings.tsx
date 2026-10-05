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
import { withCustomProvider, type CustomProviderDraft } from './custom-provider'
import { settingsApi } from '@/api/settings'
import { useOpenCodeConfigFile, OPEN_CODE_CONFIG_QUERY_KEY } from '@/hooks/useOpenCodeConfigFile'
import { invalidateConfigCaches, invalidateProviderCaches } from '@/lib/queryInvalidation'
import { showErrorToast } from '@/lib/error-toast'
import { showToast } from '@/lib/toast'
import { useI18n } from '@/lib/i18n'
import type { OpenCodeConfigFile } from '@/api/types/settings'

export function ProviderSettings() {
  const { t } = useI18n()
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
  const [isCustomProviderOpen, setIsCustomProviderOpen] = useState(false)
  const [customProviderError, setCustomProviderError] = useState<string | null>(null)
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
  // reports. So this writes `provider.<id>` into the OpenCode config and lets
  // the next load pick it up.
  const { data: openCodeConfig } = useOpenCodeConfigFile()
  const declaredProviderIds = useMemo(
    () => Object.keys((openCodeConfig?.content.provider as Record<string, unknown> | undefined) ?? {}),
    [openCodeConfig],
  )

  const createCustomProviderMutation = useMutation({
    mutationFn: async (draft: CustomProviderDraft) => {
      const current = queryClient.getQueryData<OpenCodeConfigFile>(OPEN_CODE_CONFIG_QUERY_KEY)
      if (!current) {
        throw new Error('opencode-config-not-loaded')
      }
      return settingsApi.updateOpenCodeConfig({
        content: withCustomProvider(current.content, draft),
        expectedRevision: current.revision,
      })
    },
    onSuccess: () => {
      // The provider list is cached from OpenCode's own last answer, and the
      // config file is what was just changed; both have to be re-read or the
      // new provider does not show up until the page is reloaded.
      invalidateConfigCaches(queryClient)
      invalidateProviderCaches(queryClient)
      setIsCustomProviderOpen(false)
      setCustomProviderError(null)
      showToast.success(t('settingsPanels.customProvider.created'))
    },
    onError: (error) => {
      // Twice, on purpose: the toast is the same channel the delete path uses,
      // and the dialog deliberately stays open - where a toast behind a modal
      // is easy to miss. A conflict (409) carries the server's own wording,
      // which says what changed and is worth showing verbatim.
      const message = error instanceof Error && error.message ? error.message : t('settingsPanels.customProvider.createFailed')
      setCustomProviderError(message)
      showErrorToast(error, t('settingsPanels.customProvider.createFailed'))
    },
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

  if (providersLoading || credentialsLoading) {
    return (
      <PanelLoading />
    )
  }

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

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground mb-2">{t('settingsPanels.provider.apiKeys')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settingsPanels.provider.apiKeysDescription')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCustomProviderError(null)
                setIsCustomProviderOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              {t('settingsPanels.provider.createCustom')}
            </Button>
          </div>

        <div className="space-y-3">
          <button
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
        open={isCustomProviderOpen}
        onOpenChange={(open) => {
          setIsCustomProviderOpen(open)
          if (!open) setCustomProviderError(null)
        }}
        existingProviderIds={declaredProviderIds}
        isSubmitting={createCustomProviderMutation.isPending}
        error={customProviderError}
        onSubmit={(draft) => {
          // `mutate` is fire-and-forget by design; the dialog closes in the
          // mutation's own `onSuccess` so a failure leaves it open with the
          // fields still in it.
          createCustomProviderMutation.mutate(draft)
        }}
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
