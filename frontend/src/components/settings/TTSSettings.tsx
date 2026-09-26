import { useEffect, useState, useRef } from 'react'
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
  
  // External provider specific validation
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
  
  // Voice requirement depends on provider
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
  const { preferences, updateSettings } = useSettings()
  const { speakWithConfig, stop, isPlaying, isLoading: isTTSLoading, error: ttsError } = useTTS()
  const { refreshAll } = useTTSDiscovery()
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false)
  const [browserVoices, setBrowserVoices] = useState<string[]>([])
  const [isCheckingBuiltin, setIsCheckingBuiltin] = useState(false)
  
  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedDataRef = useRef<TTSFormValues | null>(null)
  
  const form = useForm<TTSFormValues>({
    resolver: zodResolver(ttsFormSchema),
    defaultValues: DEFAULT_TTS_CONFIG,
  })
  
  const { reset, formState: { isDirty, isValid }, getValues } = form
  
  // Fetch available models and voices for external provider
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
  
  const watchEnabled = form.watch('enabled')
  const watchProvider = form.watch('provider')
  const watchApiKey = form.watch('apiKey')
  const watchEndpoint = form.watch('endpoint')
  const watchVoice = form.watch('voice')
  const watchModel = form.watch('model')
  const watchSpeed = form.watch('speed')
  
  // Check builtin Web Speech API support
  const hasWebSpeechSupport = isWebSpeechSupported()
  
  // Determine if test button should be enabled
  // With auto-save, we allow testing as long as settings are valid (no need to wait for save)
  const canTest = (() => {
    if (!watchEnabled) return false
    
    if (watchProvider === 'builtin') {
      return hasWebSpeechSupport && browserVoices.length > 0 && !!watchVoice && !isCheckingBuiltin
    } else {
      return !!watchApiKey && !!watchVoice && !isLoadingVoices
    }
  })()
  
  // Load browser voices when provider is builtin
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
  
  // Load preferences into form
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
      lastSavedDataRef.current = preferences.tts
      setSaveStatus('idle')
    }
  }, [preferences?.tts, reset])
  
  // Auto-save on change with debouncing
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    if (!isDirty) {
      setSaveStatus('idle')
      return
    }
    
    if (!isValid) {
      setSaveStatus('idle')
      return
    }
    
    setSaveStatus('saving')
    
    saveTimeoutRef.current = setTimeout(() => {
      const formData = getValues()
      
      if (lastSavedDataRef.current && JSON.stringify(formData) === JSON.stringify(lastSavedDataRef.current)) {
        setSaveStatus('idle')
        return
      }
      
      updateSettings({ tts: formData })
      lastSavedDataRef.current = formData
      setSaveStatus('saved')
      
      setTimeout(() => {
        setSaveStatus('idle')
      }, 1500)
      
    }, 800)
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [watchEnabled, watchProvider, watchApiKey, watchEndpoint, watchVoice, watchModel, watchSpeed, isValid, isDirty, getValues, updateSettings])
  
  const handleTest = () => {
    const formData = getValues()
    speakWithConfig(t('settingsPanels.tts.testPhrase'), formData)
  }
  
  const handleStopTest = () => {
    stop()
  }
  
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-foreground">{t('settingsPanels.tts.title')}</h2>
        {/* Show auto-save status instead of save button */}
        <div className="flex items-center gap-2 text-sm">
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
        </div>
      </div>
      
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
                              // Auto-save will handle debounced save
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
                              // Auto-save will handle debounced save
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
    </div>
  )
}
