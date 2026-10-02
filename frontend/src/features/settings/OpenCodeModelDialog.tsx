import { useForm } from 'react-hook-form'
import { DialogLayout } from '@/components/ui/dialog-layout'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { RefreshCw, Loader2 } from 'lucide-react'
import { settingsApi } from '@/api/settings'
import { useI18n, i18n } from '@/lib/i18n'
import type { ModelConfig, ProviderConfig } from '@/api/types/settings'

type ConfigModel = Partial<ModelConfig> & {
  limit?: {
    context?: number
    input?: number
    output?: number
  }
} & Record<string, unknown>

type ConfigProvider = Omit<Partial<ProviderConfig>, 'models' | 'env'> & {
  api?: string
  npm?: string
  env?: string[]
  models?: Record<string, ConfigModel>
} & Record<string, unknown>

const handledModelKeys = new Set([
  'id',
  'providerID',
  'api',
  'name',
  'family',
  'capabilities',
  'cost',
  'limit',
  'status',
  'options',
  'headers',
  'release_date',
  'variants',
])

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function stringifyJson(value: unknown): string {
  if (!value || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function parseOptionalJsonField(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined
  return parseJsonObject(value) ?? undefined
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function prettifyModelName(modelId: string): string {
  return modelId
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function jsonObjectField(labelKey: string) {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) return
    if (!parseJsonObject(value)) {
      ctx.addIssue({
        code: 'custom',
        message: i18n.t('settingsPanels.modelDialog.errors.mustBeJson', { label: i18n.t(labelKey) }),
      })
    }
  })
}

const modelFormSchema = z.object({
  providerId: z.string(),
  modelId: z.string().min(1, i18n.t('settingsPanels.modelDialog.errors.modelIdRequired')).regex(/^[a-zA-Z0-9._-]+$/, i18n.t('settingsPanels.modelDialog.errors.modelIdFormat')),
  backingModelId: z.string(),
  providerModelProviderId: z.string(),
  displayName: z.string(),
  family: z.string(),
  status: z.enum(['none', 'alpha', 'beta', 'deprecated', 'active']),
  releaseDate: z.string(),
  apiUrl: z.string(),
  apiNpm: z.string(),
  contextLimit: z.string(),
  inputLimit: z.string(),
  outputLimit: z.string(),
  capabilitiesJson: jsonObjectField('settingsPanels.modelDialog.fields.capabilities'),
  costJson: jsonObjectField('settingsPanels.modelDialog.fields.cost'),
  optionsJson: jsonObjectField('settingsPanels.modelDialog.fields.options'),
  headersJson: jsonObjectField('settingsPanels.modelDialog.fields.headers'),
  variantsJson: jsonObjectField('settingsPanels.modelDialog.fields.variants'),
  extraJson: jsonObjectField('settingsPanels.modelDialog.fields.advanced'),
  createNewProvider: z.boolean(),
  newProviderType: z.enum(['api', 'npm']),
  newProviderId: z.string(),
  newProviderName: z.string().optional(),
  newProviderBaseUrl: z.string().optional(),
  newProviderNpm: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.createNewProvider) {
    if (!data.newProviderId?.trim()) {
      ctx.addIssue({ code: 'custom', message: i18n.t('settingsPanels.modelDialog.errors.providerIdRequired'), path: ['newProviderId'] })
    } else if (!/^[a-z0-9-]+$/.test(data.newProviderId)) {
      ctx.addIssue({ code: 'custom', message: i18n.t('settingsPanels.modelDialog.errors.providerIdFormat'), path: ['newProviderId'] })
    }
    if (data.newProviderType === 'api' && !data.newProviderBaseUrl?.trim()) {
      ctx.addIssue({ code: 'custom', message: i18n.t('settingsPanels.modelDialog.errors.baseUrlRequired'), path: ['newProviderBaseUrl'] })
    }
    if (data.newProviderType === 'npm' && !data.newProviderNpm?.trim()) {
      ctx.addIssue({ code: 'custom', message: i18n.t('settingsPanels.modelDialog.errors.npmRequired'), path: ['newProviderNpm'] })
    }
  } else {
    if (!data.providerId?.trim()) {
      ctx.addIssue({ code: 'custom', message: i18n.t('settingsPanels.modelDialog.errors.providerRequired'), path: ['providerId'] })
    }
  }

  for (const [field, labelKey] of [
    ['contextLimit', 'settingsPanels.modelDialog.limitFields.context'],
    ['inputLimit', 'settingsPanels.modelDialog.limitFields.input'],
    ['outputLimit', 'settingsPanels.modelDialog.limitFields.output'],
  ] as const) {
    const value = data[field]
    if (value.trim() && parseOptionalNumber(value) === undefined) {
      ctx.addIssue({ code: 'custom', message: i18n.t('settingsPanels.modelDialog.errors.mustBeNumber', { label: i18n.t(labelKey) }), path: [field] })
    }
  }
})

type ModelFormValues = z.infer<typeof modelFormSchema>

export interface NewProviderConfig {
  id: string
  type: 'api' | 'npm'
  name?: string
  baseUrl?: string
  npm?: string
}

interface OpenCodeModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (providerId: string, modelId: string, model: ConfigModel, newProvider?: NewProviderConfig) => void
  availableProviders: string[]
  existingProviders?: Record<string, ConfigProvider>
  selectedProviderId: string
  editingModel?: {
    providerId: string
    modelId: string
    model: ConfigModel
  }
}

export function OpenCodeModelDialog({
  open,
  onOpenChange,
  onSubmit,
  availableProviders,
  existingProviders,
  selectedProviderId,
  editingModel,
}: OpenCodeModelDialogProps) {
  const { t } = useI18n()
  const getDefaultValues = useCallback((): ModelFormValues => {
    if (editingModel) {
      const extraEntries = Object.fromEntries(
        Object.entries(editingModel.model).filter(([key]) => !handledModelKeys.has(key))
      )

      return {
        providerId: editingModel.providerId,
        modelId: editingModel.modelId,
        backingModelId: typeof editingModel.model.id === 'string' ? editingModel.model.id : '',
        providerModelProviderId: typeof editingModel.model.providerID === 'string' ? editingModel.model.providerID : '',
        displayName: editingModel.model.name || '',
        family: editingModel.model.family || '',
        status: (editingModel.model.status as ModelFormValues['status']) || 'none',
        releaseDate: editingModel.model.release_date || '',
        apiUrl: editingModel.model.api?.url || '',
        apiNpm: editingModel.model.api?.npm || '',
        contextLimit: editingModel.model.limit?.context?.toString() || '',
        inputLimit: editingModel.model.limit?.input?.toString() || '',
        outputLimit: editingModel.model.limit?.output?.toString() || '',
        capabilitiesJson: stringifyJson(editingModel.model.capabilities),
        costJson: stringifyJson(editingModel.model.cost),
        optionsJson: stringifyJson(editingModel.model.options),
        headersJson: stringifyJson(editingModel.model.headers),
        variantsJson: stringifyJson(editingModel.model.variants),
        extraJson: stringifyJson(extraEntries),
        createNewProvider: false,
        newProviderType: 'api',
        newProviderId: '',
        newProviderName: '',
        newProviderBaseUrl: '',
        newProviderNpm: '',
      }
    }

    return {
      providerId: selectedProviderId || availableProviders[0] || '',
      modelId: '',
      backingModelId: '',
      providerModelProviderId: '',
      displayName: '',
      family: '',
      status: 'none',
      releaseDate: '',
      apiUrl: '',
      apiNpm: '',
      contextLimit: '',
      inputLimit: '',
      outputLimit: '',
      capabilitiesJson: '',
      costJson: '',
      optionsJson: '',
      headersJson: '',
      variantsJson: '',
      extraJson: '',
      createNewProvider: availableProviders.length === 0,
      newProviderType: 'api',
      newProviderId: '',
      newProviderName: '',
      newProviderBaseUrl: '',
      newProviderNpm: '',
    }
  }, [editingModel, selectedProviderId, availableProviders])

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: getDefaultValues(),
    mode: 'onChange',
  })

  const { isValid } = form.formState
  const createNewProvider = form.watch('createNewProvider')
  const newProviderType = form.watch('newProviderType')
  const watchedProviderId = form.watch('providerId')
  const watchedNewProviderBaseUrl = form.watch('newProviderBaseUrl')
  const resetKeyRef = useRef<string | null>(null)
  const resetKey = editingModel
    ? `edit-${editingModel.providerId}-${editingModel.modelId}`
    : `create-${selectedProviderId || availableProviders[0] || ''}`

  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [discoveryApiKey, setDiscoveryApiKey] = useState('')

  const discoveryBaseUrl = useMemo(() => {
    if (createNewProvider) {
      return watchedNewProviderBaseUrl?.trim() || ''
    }
    const provider = existingProviders?.[watchedProviderId]
    const options = provider?.options as { baseURL?: string } | undefined
    return (options?.baseURL || provider?.api || '').trim()
  }, [createNewProvider, watchedNewProviderBaseUrl, watchedProviderId, existingProviders])

  const discoverModels = useCallback(async (forceRefresh = false) => {
    if (!discoveryBaseUrl) {
      setDiscoveredModels([])
      return
    }
    try {
      new URL(discoveryBaseUrl)
    } catch {
      setDiscoveredModels([])
      return
    }
    setIsLoadingModels(true)
    setDiscoveryError(null)
    try {
      const response = await settingsApi.discoverOpenCodeModels(discoveryBaseUrl, discoveryApiKey || undefined, forceRefresh)
      setDiscoveredModels(response.models)
    } catch {
      setDiscoveredModels([])
      setDiscoveryError(t('settingsPanels.modelDialog.discoveryFailed'))
    } finally {
      setIsLoadingModels(false)
    }
  }, [discoveryBaseUrl, discoveryApiKey, t])

  useEffect(() => {
    if (!open) return
    if (!discoveryBaseUrl) {
      setDiscoveredModels([])
      setDiscoveryError(null)
      return
    }
    if (createNewProvider && newProviderType !== 'api') return
    const timer = setTimeout(() => {
      void discoverModels()
    }, 600)
    return () => clearTimeout(timer)
  }, [open, discoveryBaseUrl, createNewProvider, newProviderType, discoverModels])

  const handleDiscoveredModelSelect = useCallback((modelId: string) => {
    const currentModelId = form.getValues('modelId')
    const sanitized = sanitizeModelId(modelId)
    if (!currentModelId && sanitized) {
      form.setValue('modelId', sanitized, { shouldValidate: true, shouldDirty: true })
    }
    const currentDisplayName = form.getValues('displayName')
    if (!currentDisplayName) {
      form.setValue('displayName', prettifyModelName(modelId), { shouldValidate: true, shouldDirty: true })
    }
  }, [form])

  useEffect(() => {
    if (!open) {
      resetKeyRef.current = null
      setDiscoveredModels([])
      setDiscoveryError(null)
      setDiscoveryApiKey('')
      return
    }

    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey
      form.reset(getDefaultValues())
      void form.trigger()
    }
  }, [open, resetKey, form, getDefaultValues])

  const handleSubmit = (values: ModelFormValues) => {
    const extra = parseOptionalJsonField(values.extraJson)
    const capabilities = parseOptionalJsonField(values.capabilitiesJson)
    const cost = parseOptionalJsonField(values.costJson)
    const options = parseOptionalJsonField(values.optionsJson)
    const headers = parseOptionalJsonField(values.headersJson)
    const variants = parseOptionalJsonField(values.variantsJson)

    const model: ConfigModel = {
      ...(extra || {}),
    }

    if (values.backingModelId.trim()) model.id = values.backingModelId.trim()
    if (values.providerModelProviderId.trim()) model.providerID = values.providerModelProviderId.trim()
    if (values.displayName.trim()) model.name = values.displayName.trim()
    if (values.family.trim()) model.family = values.family.trim()
    if (values.status !== 'none') model.status = values.status
    if (values.releaseDate.trim()) model.release_date = values.releaseDate.trim()

    if (values.apiUrl.trim() || values.apiNpm.trim()) {
      model.api = { url: values.apiUrl.trim(), ...(values.apiNpm.trim() ? { npm: values.apiNpm.trim() } : {}) }
    }

    const contextLimit = parseOptionalNumber(values.contextLimit)
    const inputLimit = parseOptionalNumber(values.inputLimit)
    const outputLimit = parseOptionalNumber(values.outputLimit)
    if (contextLimit !== undefined || inputLimit !== undefined || outputLimit !== undefined) {
      model.limit = {
        ...(contextLimit !== undefined ? { context: contextLimit } : {}),
        ...(inputLimit !== undefined ? { input: inputLimit } : {}),
        ...(outputLimit !== undefined ? { output: outputLimit } : {}),
      } as ConfigModel['limit']
    }

    if (capabilities) model.capabilities = capabilities as ConfigModel['capabilities']
    if (cost) model.cost = cost as ConfigModel['cost']
    if (options) model.options = options
    if (headers) model.headers = headers as Record<string, string>
    if (variants) model.variants = variants as ConfigModel['variants']

    let newProvider: NewProviderConfig | undefined
    if (values.createNewProvider) {
      newProvider = {
        id: values.newProviderId,
        type: values.newProviderType,
        name: values.newProviderName || undefined,
        baseUrl: values.newProviderBaseUrl || undefined,
        npm: values.newProviderNpm || undefined,
      }
    }

    if (newProvider) onSubmit(values.providerId, values.modelId, model, newProvider)
    else onSubmit(values.providerId, values.modelId, model)

    form.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) form.reset()
    onOpenChange(isOpen)
  }

  const providerOptions = useMemo(() => {
    return availableProviders.map((p: string) => ({ value: p, label: existingProviders?.[p]?.name || p }))
  }, [availableProviders, existingProviders])

  const discoveredModelOptions = useMemo(
    () => discoveredModels.map((m) => ({ value: m, label: m })),
    [discoveredModels],
  )

  const isEditing = !!editingModel

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} key={editingModel ? `edit-${editingModel.modelId}` : 'create'}>
      <DialogContent mobileFullscreen className="sm:max-w-2xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogLayout
          title={isEditing ? t('settingsPanels.modelDialog.editTitle') : t('settingsPanels.modelDialog.createTitle')}
          onBodyClick={(e) => e.stopPropagation()}
          onBodyPointerDown={(e) => e.stopPropagation()}
        >
          <Form {...form}>
            <div className="space-y-4">
              {!isEditing && (
                <FormField
                  control={form.control}
                  name="createNewProvider"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>{t('settingsPanels.modelDialog.createNewProvider')}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t('settingsPanels.modelDialog.createNewProviderDescription')}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}

              {createNewProvider ? (
                <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                  <h4 className="text-sm font-medium">{t('settingsPanels.modelDialog.newProvider')}</h4>

                  <FormField control={form.control} name="newProviderType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.modelDialog.providerType')}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="api">{t('settingsPanels.modelDialog.providerTypeApi')}</SelectItem>
                          <SelectItem value="npm">{t('settingsPanels.modelDialog.providerTypeNpm')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="newProviderId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.modelDialog.providerId')}</FormLabel>
                      <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.providerIdPlaceholder')} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="newProviderName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.modelDialog.displayName')}</FormLabel>
                      <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.displayNamePlaceholder')} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {newProviderType === 'api' && (
                    <FormField control={form.control} name="newProviderBaseUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.modelDialog.baseUrl')}</FormLabel>
                        <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.baseUrlPlaceholder')} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {newProviderType === 'api' && (
                    <div className="space-y-2">
                      <Label htmlFor="discovery-api-key">{t('settingsPanels.modelDialog.apiKeyDiscovery')}</Label>
                      <Input
                        id="discovery-api-key"
                        type="password"
                        value={discoveryApiKey}
                        onChange={(e) => setDiscoveryApiKey(e.target.value)}
                        placeholder={t('settingsPanels.modelDialog.apiKeyDiscoveryPlaceholder')}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('settingsPanels.modelDialog.apiKeyDiscoveryDescription')}
                      </p>
                    </div>
                  )}

                  {newProviderType === 'npm' && (
                    <FormField control={form.control} name="newProviderNpm" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.modelDialog.npmPackage')}</FormLabel>
                        <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.npmPackagePlaceholder')} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </div>
              ) : (
                <FormField control={form.control} name="providerId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.provider')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={isEditing}>
                      <FormControl>
                        <SelectTrigger className={isEditing ? 'bg-muted' : ''}>
                          <SelectValue placeholder={t('settingsPanels.modelDialog.selectProvider')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {providerOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="modelId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.configKey')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.configKeyPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="backingModelId" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>{t('settingsPanels.modelDialog.providerModelId')}</FormLabel>
                      {discoveryBaseUrl && (
                        <button
                          type="button"
                          onClick={() => discoverModels(true)}
                          disabled={isLoadingModels}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                        >
                          {isLoadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {discoveredModels.length > 0 ? t('settingsPanels.modelDialog.refresh') : t('settingsPanels.modelDialog.discover')}
                        </button>
                      )}
                    </div>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value)
                          if (discoveredModels.includes(value)) {
                            handleDiscoveredModelSelect(value)
                          }
                        }}
                        options={discoveredModelOptions}
                        placeholder={t('settingsPanels.modelDialog.providerModelPlaceholder')}
                        disabled={isLoadingModels}
                        allowCustomValue={true}
                      />
                    </FormControl>
                    {discoveryError && <p className="text-xs text-destructive">{discoveryError}</p>}
                    {!discoveryError && isLoadingModels && <p className="text-xs text-muted-foreground">{t('settingsPanels.modelDialog.discoveringModels')}</p>}
                    {!discoveryError && !isLoadingModels && discoveredModels.length > 0 && (
                      <p className="text-xs text-muted-foreground">{t('settingsPanels.modelDialog.modelsFound', { count: discoveredModels.length })}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="displayName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.displayNameField')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.displayNameFieldPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="family" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.family')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.familyPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.status')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder={t('settingsPanels.modelDialog.selectStatus')} /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">{t('settingsPanels.modelDialog.statusNone')}</SelectItem>
                        <SelectItem value="active">{t('settingsPanels.modelDialog.statusActive')}</SelectItem>
                        <SelectItem value="beta">{t('settingsPanels.modelDialog.statusBeta')}</SelectItem>
                        <SelectItem value="alpha">{t('settingsPanels.modelDialog.statusAlpha')}</SelectItem>
                        <SelectItem value="deprecated">{t('settingsPanels.modelDialog.statusDeprecated')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="releaseDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.releaseDate')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.releaseDatePlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="providerModelProviderId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.modelProviderId')}</FormLabel>
                    <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.modelProviderIdPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="apiUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.modelDialog.apiUrl')}</FormLabel>
                      <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.optional')} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="apiNpm" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settingsPanels.modelDialog.apiNpm')}</FormLabel>
                      <FormControl><Input {...field} placeholder={t('settingsPanels.modelDialog.optional')} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField control={form.control} name="contextLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.contextLimit')}</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" placeholder={t('settingsPanels.modelDialog.contextLimitPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="inputLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.inputLimit')}</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" placeholder={t('settingsPanels.modelDialog.optional')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="outputLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.outputLimit')}</FormLabel>
                    <FormControl><Input {...field} inputMode="numeric" placeholder={t('settingsPanels.modelDialog.outputLimitPlaceholder')} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                <h4 className="text-sm font-medium">{t('settingsPanels.modelDialog.structuredJson')}</h4>

                <FormField control={form.control} name="optionsJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.optionsJson')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "temperature": 1
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="headersJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.headersJson')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "Authorization": "Bearer ..."
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="capabilitiesJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.capabilitiesJson')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "reasoning": true
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="costJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.costJson')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "input": 0.1,
  "output": 0.2
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="variantsJson" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settingsPanels.modelDialog.variantsJson')}</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={`{
  "fast": {}
}`} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="extraJson" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settingsPanels.modelDialog.advancedFieldsJson')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} className="min-h-[120px] font-mono text-xs" placeholder={t('settingsPanels.modelDialog.advancedFieldsPlaceholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </Form>
        </DialogLayout>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">{t('settingsPanels.modelDialog.cancel')}</Button>
          <Button onClick={() => form.handleSubmit(handleSubmit)()} disabled={!isValid} className="flex-1 sm:flex-none">
            {isEditing ? t('settingsPanels.modelDialog.update') : t('settingsPanels.modelDialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
