import { useEffect, useState } from 'react'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { useDebouncedFormAutoSave } from '@/hooks/useDebouncedFormAutoSave'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { useTTSModels, useTTSVoices, useTTSDiscovery } from '@/hooks/useTTSDiscovery'
import { getAvailableVoiceNames, isWebSpeechSupported } from '@/lib/webSpeechSynthesizer'
import { Loader2, Volume2, XCircle, RefreshCw, MonitorSpeaker, Globe, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SquareFill } from '@/components/ui/square-fill'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Combobox } from '@/components/ui/combobox'
import { useI18n, i18n } from '@/lib/i18n'
import { DEFAULT_TTS_CONFIG } from '@/api/types/settings'

const KOKORO_COMPOSITE_VOICE_SUGGESTIONS = [
  { value: "am_adam+am_echo", label: "Composite: am_adam+am_echo" },
  { value: "af_bella+af_nova", label: "Composite: af_bella+af_nova" },
  { value: "bm_daniel+bm_george", label: "Composite: bm_daniel+bm_george" },
]

function isKokoroStyleVoice(voice: string): boolean {
  return /^[a-z]{2}_/.test(voice)
}

const ttsFormSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['external', 'builtin']),
  autoPlay: z.boolean(),
  endpoint: z.string(),
  apiKey: z.string(),
  voice: z.string(),
  model: z.string(),
  speed: z.number().min(0.25).max(4.0),
}).superRefine((data, ctx) => {
  if (!data.enabled) return
  
  if (data.provider === 'external') {
    if (!data.apiKey || data.apiKey.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message: i18n.t('settingsPanels.tts.errors.apiKeyRequired'),
      })
    }
    if (!data.endpoint || data.endpoint.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoint'],
        message: i18n.t('settingsPanels.tts.errors.endpointRequired'),
      })
    }
  }
  
  if (!data.voice || data.voice.trim().length === 0) {
    if (data.provider === 'builtin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['voice'],
        message: i18n.t('settingsPanels.tts.errors.selectBrowserVoice'),
      })
    }
  }
})

type TTSFormValues = z.infer<typeof ttsFormSchema>

export function TTSSettings() {
  const { t } = useI18n()
  const { preferences, updateSettingsAsync } = useSettings()
  const { speakWithConfig, stop, isPlaying, isLoading: isTTSLoading, error: ttsError } = useTTS()
  const { refreshAll } = useTTSDiscovery()
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false)
  const [browserVoices, setBrowserVoices] = useState<string[]>([])
  const [isCheckingBuiltin, setIsCheckingBuiltin] = useState(false)
  
  
  const form = useForm<TTSFormValues>({
    resolver: zodResolver(ttsFormSchema),
    defaultValues: DEFAULT_TTS_CONFIG,
  })
  
  const { reset, formState: { isDirty, isValid }, getValues } = form
  
  const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useTTSModels(
    undefined,
    true
  )
  
  const { data: voicesData, isLoading: isLoadingVoices, refetch: refetchVoices } = useTTSVoices(
    undefined,
    true
  )
  
  const availableModels = modelsData?.models || preferences?.tts?.availableModels || []
  const availableVoices = voicesData?.voices || preferences?.tts?.availableVoices || []
  const modelsCached = modelsData?.cached || false
  const voicesCached = voicesData?.cached || false
  // A built-in list is not the provider's list, and has to be labelled as such
  const modelsSourceIsDefault = modelsData?.source === 'defaults'
  const voicesSourceIsDefault = voicesData?.source === 'defaults'
  
  const watchEnabled = form.watch('enabled')
  const watchProvider = form.watch('provider')
  const watchApiKey = form.watch('apiKey')
  const watchEndpoint = form.watch('endpoint')
  const watchVoice = form.watch('voice')
  const watchModel = form.watch('model')
  const watchSpeed = form.watch('speed')
  
  const hasWebSpeechSupport = isWebSpeechSupported()
  
  const canTest = (() => {
    if (!watchEnabled) return false
    
    if (watchProvider === 'builtin') {
      return hasWebSpeechSupport && browserVoices.length > 0 && !!watchVoice && !isCheckingBuiltin
    } else {
      // must match what /synthesize actually requires, or the button invites a
      // click that can only come back as a 400 about the wrong field
      return !!watchApiKey && !!watchEndpoint && !!watchVoice && !!watchModel && !isLoadingVoices
    }
  })()
  
  useEffect(() => {
    if (watchProvider === 'builtin' && watchEnabled) {
      setIsCheckingBuiltin(true)
      getAvailableVoiceNames()
        .then((voices) => {
          setBrowserVoices(voices)
          setIsCheckingBuiltin(false)
        })
        .catch(() => {
          setBrowserVoices([])
          setIsCheckingBuiltin(false)
        })
    }
  }, [watchProvider, watchEnabled])
  
  const handleRefreshDiscovery = async () => {
    setIsRefreshingDiscovery(true)
    try {
      await refreshAll()
      await Promise.all([
        refetchModels(),
        refetchVoices()
      ])
    } finally {
      setIsRefreshingDiscovery(false)
    }
  }
  
  const handleCheckBuiltin = async () => {
    setIsCheckingBuiltin(true)
    try {
      const voices = await getAvailableVoiceNames()
      setBrowserVoices(voices)
    } finally {
      setIsCheckingBuiltin(false)
    }
  }
  
  useEffect(() => {
    if (preferences?.tts) {
      reset({
        enabled: preferences.tts.enabled ?? DEFAULT_TTS_CONFIG.enabled,
        provider: preferences.tts.provider ?? DEFAULT_TTS_CONFIG.provider,
        autoPlay: preferences.tts.autoPlay ?? DEFAULT_TTS_CONFIG.autoPlay,
        endpoint: preferences.tts.endpoint ?? DEFAULT_TTS_CONFIG.endpoint,
        apiKey: preferences.tts.apiKey ?? DEFAULT_TTS_CONFIG.apiKey,
        voice: preferences.tts.voice ?? DEFAULT_TTS_CONFIG.voice,
        model: preferences.tts.model ?? DEFAULT_TTS_CONFIG.model,
        speed: preferences.tts.speed ?? DEFAULT_TTS_CONFIG.speed,
      })
    }
  }, [preferences?.tts, reset])
  
  const saveStatus = useDebouncedFormAutoSave<TTSFormValues>({
    watchedValues: [watchEnabled, watchProvider, watchApiKey, watchEndpoint, watchVoice, watchModel, watchSpeed],
    getValues,
    // async rather than a bare arrow so the promise survives: the hook waits on
    // it before claiming 'saved', and updateSettingsAsync resolves with the
    // response object, not void
    onSave: async (formData) => { await updateSettingsAsync({ tts: formData }) },
    isDirty,
    isValid,
    skipIfUnchanged: true,
  })
  
  const handleTest = async () => {
    const formData = getValues()
    // /synthesize reads the persisted settings, not this form. Auto-save is
    // debounced by 800ms, so a test clicked straight after editing used to ask
    // the server about the *previous* save - and "TTS is not enabled" came back
    // for a switch that was plainly on. Persist first, then test what was typed.
    try {
      await updateSettingsAsync({ tts: formData })
    } catch {
      // the save failed; speakWithConfig reports whatever the server answers,
      // and a refusal to save is itself worth seeing
    }
    speakWithConfig(t('settingsPanels.tts.testPhrase'), formData)
  }
  
  const handleStopTest = () => {
    stop()
  }
  
  return (
    <SettingsPanel title={t('settingsPanels.tts.title')} actions={
      <>
        {saveStatus === 'saving' && (
        <>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">{t('settingsPanels.tts.saving')}</span>
      </>
            )}
            {saveStatus === 'saved' && (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-green-600">{t('settingsPanels.tts.saved')}</span>
              </>
            )}
            {saveStatus === 'idle' && isDirty && isValid && (
              <span className="text-amber-600">{t('settingsPanels.tts.unsavedChanges')}</span>
            )}
            {saveStatus === 'idle' && !isDirty && (
              <span className="text-muted-foreground">{t('settingsPanels.tts.allChangesSaved')}</span>
            )}
      </>
      }>
      
      <Form {...form}>
        <form className="space-y-6">
          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">{t('settingsPanels.tts.enable')}</FormLabel>
                  <FormDescription>
                    {t('settingsPanels.tts.enableDescription')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {watchEnabled && (
            <FormField
              control={form.control}
              name="autoPlay"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{t('settingsPanels.tts.autoPlay')}</FormLabel>
                    <FormDescription>
                      {t('settingsPanels.tts.autoPlayDescription')}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          )}

          {watchEnabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('provider', 'builtin', { shouldDirty: true })
                    form.setValue('apiKey', '', { shouldDirty: true })
                    form.setValue('endpoint', '', { shouldDirty: true })
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition ${
                    watchProvider === 'builtin'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-blue-300'
                  }`}
                >
                  <MonitorSpeaker className={`h-6 w-6 ${watchProvider === 'builtin' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                  <span className={`font-medium ${watchProvider === 'builtin' ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    {t('settingsPanels.tts.builtin')}
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    {t('settingsPanels.tts.builtinHint')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    form.setValue('provider', 'external', { shouldDirty: true })
                  }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 p-4 transition ${
                    watchProvider === 'external'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-border hover:border-blue-300'
                  }`}
                >
                  <Globe className={`h-6 w-6 ${watchProvider === 'external' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                  <span className={`font-medium ${watchProvider === 'external' ? 'text-blue-700 dark:text-blue-300' : ''}`}>
                    {t('settingsPanels.tts.external')}
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    {t('settingsPanels.tts.externalHint')}
                  </span>
                </button>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t('settingsPanels.tts.chooseProvider')}
              </div>

              {/* External Provider Settings */}
              {watchProvider === 'external' && (
                <>
                  <FormField
                    control={form.control}
                    name="endpoint"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.tts.serverUrl')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="https://api.openai.com"
                            className="bg-background"
                            {...field}
                            onChange={(e) => {
                              field.onChange(e)
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settingsPanels.tts.serverUrlDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.tts.apiKey')}</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="sk-..."
                            className="bg-background"
                            {...field}
                            onChange={(e) => {
                              field.onChange(e)
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settingsPanels.tts.apiKeyDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="voice"
                    render={({ field }) => {
                      const hasKokoroVoices = availableVoices.some(isKokoroStyleVoice)
                      const voiceOptions = [
                        ...availableVoices.slice(0, 10).map((voice: string) => ({
                          value: voice,
                          label: voice
                        })),
                        ...(hasKokoroVoices ? KOKORO_COMPOSITE_VOICE_SUGGESTIONS : []),
                        ...availableVoices.slice(10).map((voice: string) => ({
                          value: voice,
                          label: voice
                        }))
                      ]
                      
                      return (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.tts.voice')}</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value}
                            onChange={field.onChange}
                            options={voiceOptions}
                            placeholder={hasKokoroVoices ? t('settingsPanels.tts.voicePlaceholderKokoro') : t('settingsPanels.tts.voicePlaceholder')}
                            disabled={!watchEnabled || isLoadingVoices}
                            allowCustomValue={true}
                          />
                        </FormControl>
                        <FormDescription>
                          {isLoadingVoices ? t('settingsPanels.tts.loadingVoices') :
                           voicesSourceIsDefault ? t('settingsPanels.tts.voiceListIsDefault') :
                           voicesCached ? t('settingsPanels.tts.availableVoicesCached', { count: availableVoices.length }) :
                           availableVoices.length > 0 ? (hasKokoroVoices ? t('settingsPanels.tts.availableVoicesComposite', { count: availableVoices.length }) : t('settingsPanels.tts.availableVoices', { count: availableVoices.length })) :
                           watchEnabled && watchApiKey ? t('settingsPanels.tts.noVoices') :
                           t('settingsPanels.tts.configureTtsVoices')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                      )
                    }}
                  />

                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.tts.model')}</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value}
                            onChange={field.onChange}
                            options={availableModels.map((model: string) => ({
                              value: model,
                              label: model
                            }))}
                            placeholder={t('settingsPanels.tts.modelPlaceholder')}
                            disabled={!watchEnabled || isLoadingModels}
                            allowCustomValue={true}
                          />
                        </FormControl>
                        <FormDescription>
                          {isLoadingModels ? t('settingsPanels.tts.loadingModels') :
                           modelsSourceIsDefault ? t('settingsPanels.tts.modelListIsDefault') :
                           modelsCached ? t('settingsPanels.tts.availableModelsCached', { count: availableModels.length }) :
                           availableModels.length > 0 ? t('settingsPanels.tts.availableModels', { count: availableModels.length }) :
                           watchEnabled && watchApiKey ? t('settingsPanels.tts.noModels') :
                           t('settingsPanels.tts.configureTtsModels')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                      <div className="text-base font-medium">{t('settingsPanels.tts.refreshDiscoveryTitle')}</div>
                      <p className="text-sm text-muted-foreground">
                        {t('settingsPanels.tts.refreshDiscoveryDescription')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRefreshDiscovery}
                      disabled={!watchEnabled || !watchApiKey || isRefreshingDiscovery}
                    >
                      {isRefreshingDiscovery ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t('settingsPanels.tts.refreshing')}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          {t('settingsPanels.tts.refresh')}
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}

              {/* Builtin Provider Settings */}
              {watchProvider === 'builtin' && (
                <>
                  <FormField
                    control={form.control}
                    name="voice"
                    render={({ field }) => {
                      const voiceOptions = browserVoices.map((voice: string) => ({
                        value: voice,
                        label: voice
                      }))
                      
                      return (
                      <FormItem>
                        <FormLabel>{t('settingsPanels.tts.browserVoice')}</FormLabel>
                        <FormControl>
                          <Combobox
                            value={field.value}
                            onChange={field.onChange}
                            options={voiceOptions}
                            placeholder={isCheckingBuiltin ? t('settingsPanels.tts.loadingVoicesShort') : t('settingsPanels.tts.voicePlaceholder')}
                            disabled={!watchEnabled || isCheckingBuiltin || browserVoices.length === 0}
                            allowCustomValue={false}
                          />
                        </FormControl>
                        <FormDescription>
                          {isCheckingBuiltin ? (
                            <span className="flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t('settingsPanels.tts.checkingVoices')}
                            </span>
                          ) : browserVoices.length > 0 ? (
                            t('settingsPanels.tts.browserVoicesAvailable', { count: browserVoices.length })
                          ) : !hasWebSpeechSupport ? (
                            <span className="text-destructive">{t('settingsPanels.tts.webSpeechUnsupportedInline')}</span>
                          ) : (
                            t('settingsPanels.tts.noVoicesFound')
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                      )
                    }}
                  />

                  {!hasWebSpeechSupport && (
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4">
                      <div className="text-sm text-yellow-800 dark:text-yellow-200">
                        <strong>{t('settingsPanels.tts.browserNotSupportedTitle')}</strong>{t('settingsPanels.tts.browserNotSupportedBody')}
                      </div>
                    </div>
                  )}

                  {hasWebSpeechSupport && browserVoices.length === 0 && (
                    <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                      <div className="space-y-0.5">
                        <div className="text-base font-medium">{t('settingsPanels.tts.checkForVoices')}</div>
                        <p className="text-sm text-muted-foreground">
                          {t('settingsPanels.tts.checkForVoicesDescription')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCheckBuiltin}
                        disabled={isCheckingBuiltin}
                      >
                        {isCheckingBuiltin ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            {t('settingsPanels.tts.checking')}
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {t('settingsPanels.tts.checkForVoices')}
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* Common Settings for both providers */}
              <FormField
                control={form.control}
                name="speed"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between">
                      <FormLabel>{t('settingsPanels.tts.speed')}</FormLabel>
                      <span className="text-sm text-muted-foreground">
                        {field.value.toFixed(2)}x
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        min={0.25}
                        max={4.0}
                        step={0.25}
                        value={[field.value]}
                        onValueChange={(values) => field.onChange(values[0])}
                        className="w-full"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settingsPanels.tts.speedDescription')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <div className="text-base font-medium">{t('settingsPanels.tts.testTts')}</div>
                  <p className="text-sm text-muted-foreground">
                    {t('settingsPanels.tts.testTtsDescription')}
                  </p>
                  {ttsError && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      {ttsError}
                    </p>
                  )}
                  {watchProvider === 'builtin' && !hasWebSpeechSupport && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <XCircle className="h-4 w-4" />
                      {t('settingsPanels.tts.webSpeechNotAvailable')}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={isPlaying || isTTSLoading ? handleStopTest : handleTest}
                  disabled={!canTest}
                >
                  {isTTSLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {t('settingsPanels.tts.testing')}
                    </>
                  ) : isPlaying ? (
                    <>
                      <SquareFill className="h-4 w-4 mr-2" />
                      {t('settingsPanels.tts.stop')}
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4 mr-2" />
                      {t('settingsPanels.tts.test')}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </form>
      </Form>
    </SettingsPanel>
  )
}
